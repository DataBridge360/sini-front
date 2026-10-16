import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import { MemoryRateLimiter } from "@/server/core/rate-limit";
import { createApiHandler } from "@/server/core/router";

// Subida de adjuntos en dos pasos (spec S5): el server firma URLs de subida
// directa a Storage y después confirma la actividad verificando cada objeto.

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const OTHER_TASK = "44444444-4444-4444-8444-444444444444";
const MB = 1_048_576;

type StoredObject = { size: number; contentType: string };

const state = {
  task: null as { id: string; status: string } | null,
  objects: new Map<string, StoredObject>(),
  usedPaths: [] as string[],
  signed: [] as string[],
  removed: [] as string[][],
  insertedMessages: [] as Array<Record<string, unknown>>,
  insertedAttachments: [] as Array<Record<string, unknown>>,
  deletedMessages: [] as unknown[],
  failAttachmentInsert: false,
  failAttachmentInsertCode: null as string | null
};

function resetState() {
  state.task = { id: TASK, status: "pendiente" };
  state.objects = new Map();
  state.usedPaths = [];
  state.signed = [];
  state.removed = [];
  state.insertedMessages = [];
  state.insertedAttachments = [];
  state.deletedMessages = [];
  state.failAttachmentInsert = false;
  state.failAttachmentInsertCode = null;
}

// Query builder falso: alcanza para las consultas de addMessage y de la firma.
function table(name: string) {
  let op: "select" | "insert" | "delete" = "select";
  let rows: Array<Record<string, unknown>> = [];
  const filters: Array<[string, unknown]> = [];
  let inFilter: [string, unknown[]] | null = null;

  const result = () => {
    if (name === "tasks") {
      const matches = state.task && filters.some(([c, v]) => c === "organization_id" && v === ORG);
      return { data: matches ? state.task : null, error: null };
    }
    if (name === "task_attachments" && op === "select") {
      const paths = (inFilter?.[1] ?? []) as string[];
      return { data: state.usedPaths.filter((path) => paths.includes(path)).map((path) => ({ storage_path: path })), error: null };
    }
    if (name === "task_attachments" && op === "insert") {
      if (state.failAttachmentInsert) return { data: null, error: { message: "boom", code: state.failAttachmentInsertCode } };
      state.insertedAttachments.push(...rows);
      return { data: rows.map((row, index) => ({ id: `att-${index}`, ...row })), error: null };
    }
    if (name === "task_messages" && op === "insert") {
      state.insertedMessages.push(...rows);
      return { data: { id: "msg-1", message: rows[0]?.message ?? null, user_id: rows[0]?.user_id }, error: null };
    }
    if (name === "task_messages" && op === "delete") {
      state.deletedMessages.push(filters);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };

  const chain = {
    select: () => chain,
    insert: (value: Record<string, unknown> | Array<Record<string, unknown>>) => {
      op = "insert";
      rows = Array.isArray(value) ? value : [value];
      return chain;
    },
    delete: () => {
      op = "delete";
      return chain;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    in: (column: string, values: unknown[]) => {
      inFilter = [column, values];
      return chain;
    },
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject)
  };
  return chain;
}

const fakeSupabase = {
  admin: {
    from: table,
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => {
          state.signed.push(`${bucket}/${path}`);
          return { data: { signedUrl: `https://sb.test/upload/${path}?token=t`, token: "t", path }, error: null };
        },
        info: async (path: string) => {
          const object = state.objects.get(path);
          return object ? { data: { ...object }, error: null } : { data: null, error: { message: "Object not found" } };
        },
        remove: async (paths: string[]) => {
          state.removed.push(paths);
          return { data: [], error: null };
        },
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://sb.test/object/${path}` })),
          error: null
        })
      })
    }
  },
  publicAuth: {}
};

vi.mock("@/server/core/supabase", () => ({ getSupabase: () => fakeSupabase }));

const { tasksRoutes } = await import("@/server/modules/tasks/routes");

const USER: AuthUser = { id: "user-1", email: "a@b.c", fullName: "Ana", avatarUrl: null, platformRole: "user" };
const ORGANIZATION: OrganizationContext = {
  id: ORG,
  slug: "norte",
  displayName: "Norte",
  primaryColor: null,
  secondaryColor: null,
  role: "productor"
};

const handle = createApiHandler(tasksRoutes, {
  basePath: "/api/v1",
  authenticate: async () => USER,
  resolveOrganization: async () => ORGANIZATION,
  rateLimiter: new MemoryRateLimiter()
});

function post(path: string, body: unknown) {
  return handle(
    new Request(`https://norte.sinipro.com/api/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer x", "x-organization-slug": "norte" },
      body: JSON.stringify(body)
    })
  );
}

const signUploads = (files: unknown) => post(`/tasks/${TASK}/attachments/uploads`, { files });
const sendMessage = (body: unknown) => post(`/tasks/${TASK}/messages`, body);

/** Firma y "sube" los archivos como lo haría el navegador. */
async function signAndStore(files: Array<{ name: string; type: string; size: number }>, stored?: Partial<StoredObject>) {
  const response = await signUploads(files);
  const { uploads } = (await response.json()) as {
    uploads: Array<{ path: string; name: string; contentType: string }>;
  };
  uploads.forEach((upload, index) => {
    state.objects.set(upload.path, {
      size: stored?.size ?? files[index]!.size,
      contentType: stored?.contentType ?? upload.contentType
    });
  });
  return uploads;
}

beforeEach(resetState);

describe("POST /tasks/:id/attachments/uploads", () => {
  it("signs one direct upload per file under the organization and task folder", async () => {
    const response = await signUploads([
      { name: "Foto Frente.JPG", type: "image/jpeg", size: 2 * MB },
      { name: "poliza.pdf", type: "application/pdf", size: 1 * MB }
    ]);

    expect(response.status).toBe(201);
    const { uploads } = await response.json();
    expect(uploads).toHaveLength(2);
    expect(uploads[0]).toMatchObject({ name: "Foto Frente.JPG", contentType: "image/jpeg", token: "t" });
    expect(uploads[0].path).toMatch(new RegExp(`^${ORG}/${TASK}/\\d+-[0-9a-f]{8}-foto-frente\\.jpg$`));
    expect(uploads[1].path).toMatch(/-poliza\.pdf$/);
    expect(uploads[0].signedUrl).toContain(uploads[0].path);
    expect(state.signed).toEqual(uploads.map((upload: { path: string }) => `task-attachments/${upload.path}`));
  });

  it("recovers the MIME type from the extension when the browser lies", async () => {
    const response = await signUploads([{ name: "planilla.csv", type: "application/octet-stream", size: 100 }]);

    const { uploads } = await response.json();
    expect(uploads[0]).toMatchObject({ contentType: "text/csv" });
    expect(uploads[0].path).toMatch(/\.csv$/);
  });

  it("rejects files over 5 MB with the same message as before and signs nothing", async () => {
    const response = await signUploads([{ name: "video.pdf", type: "application/pdf", size: 6 * MB }]);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("«video.pdf» pesa 6,0 MB. El límite es 5 MB por archivo.");
    expect(state.signed).toEqual([]);
  });

  it("rejects formats outside the allowlist", async () => {
    const response = await signUploads([{ name: "script.exe", type: "application/x-msdownload", size: 10 }]);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(
      "«script.exe» no es un formato permitido. Se permiten imágenes (PNG, JPG, WEBP, GIF), PDF, Word (DOC, DOCX) y Excel (XLS, XLSX, CSV)."
    );
    expect(state.signed).toEqual([]);
  });

  it("rejects empty files", async () => {
    const response = await signUploads([{ name: "vacio.pdf", type: "application/pdf", size: 0 }]);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("El archivo está vacío.");
  });

  it("rejects more than 10 files", async () => {
    const files = Array.from({ length: 11 }, (_, index) => ({ name: `f${index}.png`, type: "image/png", size: 10 }));
    const response = await signUploads(files);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Se pueden adjuntar hasta 10 archivos por actividad.");
    expect(state.signed).toEqual([]);
  });

  it("answers 404 for a task of another organization", async () => {
    state.task = null;
    const response = await signUploads([{ name: "a.png", type: "image/png", size: 10 }]);

    expect(response.status).toBe(404);
    expect(state.signed).toEqual([]);
  });

  it("rejects a non-UUID task id", async () => {
    const response = await post("/tasks/123/attachments/uploads", { files: [{ name: "a.png", type: "image/png", size: 10 }] });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Validation failed (uuid is expected)");
  });
});

describe("POST /tasks/:id/messages", () => {
  it("keeps text-only activities working", async () => {
    const response = await sendMessage({ message: "Llamé al cliente" });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "msg-1", message: "Llamé al cliente", attachments: [] });
    expect(state.insertedMessages).toEqual([
      { organization_id: ORG, task_id: TASK, user_id: "user-1", message: "Llamé al cliente" }
    ]);
  });

  it("requires text or at least one attachment", async () => {
    const response = await sendMessage({ message: "   " });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Escribí algo o adjuntá un archivo.");
    expect(state.insertedMessages).toEqual([]);
  });

  it("creates the message and attachment rows from the verified objects", async () => {
    const uploads = await signAndStore([
      { name: "Foto.jpg", type: "image/jpeg", size: 2 * MB },
      { name: "poliza.pdf", type: "application/pdf", size: 3 * MB }
    ]);
    const response = await sendMessage({
      message: "Adjunto fotos",
      attachments: uploads.map((upload) => ({ path: upload.path, name: upload.name }))
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.attachments).toHaveLength(2);
    expect(payload.attachments[0].url).toBe(`https://sb.test/object/${uploads[0]!.path}`);
    expect(state.insertedAttachments).toEqual([
      {
        organization_id: ORG,
        task_id: TASK,
        message_id: "msg-1",
        uploaded_by_user_id: "user-1",
        file_name: "Foto.jpg",
        mime_type: "image/jpeg",
        file_size_bytes: 2 * MB,
        storage_path: uploads[0]!.path
      },
      {
        organization_id: ORG,
        task_id: TASK,
        message_id: "msg-1",
        uploaded_by_user_id: "user-1",
        file_name: "poliza.pdf",
        mime_type: "application/pdf",
        file_size_bytes: 3 * MB,
        storage_path: uploads[1]!.path
      }
    ]);
    expect(state.removed).toEqual([]);
  });

  it.each([
    ["another organization", `${OTHER_ORG}/${TASK}/1700000000000-abcdef12-x.pdf`],
    ["another task", `${ORG}/${OTHER_TASK}/1700000000000-abcdef12-x.pdf`],
    ["a path traversal", `${ORG}/${TASK}/../${OTHER_TASK}/1700000000000-abcdef12-x.pdf`],
    ["a disallowed extension", `${ORG}/${TASK}/1700000000000-abcdef12-x.html`]
  ])("rejects a path from %s without touching storage or the database", async (_case, path) => {
    const response = await sendMessage({ attachments: [{ path, name: "x.pdf" }] });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Adjunto inválido. Volvé a adjuntar el archivo.");
    expect(state.insertedMessages).toEqual([]);
    expect(state.removed).toEqual([]);
  });

  it("rejects an object that was never uploaded and cleans up the others", async () => {
    const uploads = await signAndStore([
      { name: "a.png", type: "image/png", size: 10 },
      { name: "b.png", type: "image/png", size: 10 }
    ]);
    state.objects.delete(uploads[1]!.path);
    const response = await sendMessage({ attachments: uploads.map(({ path, name }) => ({ path, name })) });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("No se encontró «b.png». Volvé a adjuntarlo.");
    expect(state.insertedMessages).toEqual([]);
    expect(state.removed).toEqual([uploads.map((upload) => upload.path)]);
  });

  it("rejects an object whose real size exceeds 5 MB and removes it", async () => {
    const uploads = await signAndStore([{ name: "a.pdf", type: "application/pdf", size: 1 * MB }], { size: 6 * MB });
    const response = await sendMessage({ attachments: [{ path: uploads[0]!.path, name: "a.pdf" }] });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("«a.pdf» pesa 6,0 MB. El límite es 5 MB por archivo.");
    expect(state.insertedMessages).toEqual([]);
    expect(state.removed).toEqual([[uploads[0]!.path]]);
  });

  it("rejects an object stored with another content type and removes it", async () => {
    const uploads = await signAndStore([{ name: "a.pdf", type: "application/pdf", size: 10 }], { contentType: "text/html" });
    const response = await sendMessage({ attachments: [{ path: uploads[0]!.path, name: "a.pdf" }] });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(
      "«a.pdf» no es un formato permitido. Se permiten imágenes (PNG, JPG, WEBP, GIF), PDF, Word (DOC, DOCX) y Excel (XLS, XLSX, CSV)."
    );
    expect(state.removed).toEqual([[uploads[0]!.path]]);
  });

  it("rejects a path already linked to another attachment without deleting it", async () => {
    const uploads = await signAndStore([{ name: "a.png", type: "image/png", size: 10 }]);
    state.usedPaths = [uploads[0]!.path];
    const response = await sendMessage({ attachments: [{ path: uploads[0]!.path, name: "a.png" }] });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Adjunto inválido. Volvé a adjuntar el archivo.");
    expect(state.insertedMessages).toEqual([]);
    expect(state.removed).toEqual([]);
  });

  it("rejects the same path twice", async () => {
    const uploads = await signAndStore([{ name: "a.png", type: "image/png", size: 10 }]);
    const response = await sendMessage({
      attachments: [
        { path: uploads[0]!.path, name: "a.png" },
        { path: uploads[0]!.path, name: "a.png" }
      ]
    });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Adjunto inválido. Volvé a adjuntar el archivo.");
  });

  it("rolls back the message and the objects when saving the rows fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const uploads = await signAndStore([{ name: "a.png", type: "image/png", size: 10 }]);
    state.failAttachmentInsert = true;
    const response = await sendMessage({ attachments: [{ path: uploads[0]!.path, name: "a.png" }] });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("No se pudieron guardar los adjuntos.");
    expect(state.deletedMessages).toHaveLength(1);
    expect(state.removed).toEqual([[uploads[0]!.path]]);
    errorSpy.mockRestore();
  });

  it("keeps the objects when a concurrent confirmation already linked them", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const uploads = await signAndStore([{ name: "a.png", type: "image/png", size: 10 }]);
    state.failAttachmentInsert = true;
    state.failAttachmentInsertCode = "23505";
    const response = await sendMessage({ attachments: [{ path: uploads[0]!.path, name: "a.png" }] });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Adjunto inválido. Volvé a adjuntar el archivo.");
    expect(state.deletedMessages).toHaveLength(1);
    expect(state.removed).toEqual([]);
    errorSpy.mockRestore();
  });

  it("sanitizes the display name sent by the client", async () => {
    const uploads = await signAndStore([{ name: "a.png", type: "image/png", size: 10 }]);
    await sendMessage({ attachments: [{ path: uploads[0]!.path, name: "linea\nnueva\t.png" }] });

    expect(state.insertedAttachments[0]?.file_name).toBe("linea nueva .png");
  });
});

describe("POST /tasks/:id/attachments/discard", () => {
  const discard = (paths: unknown) => post(`/tasks/${TASK}/attachments/discard`, { paths });

  it("removes uploaded objects that no activity links", async () => {
    const uploads = await signAndStore([
      { name: "a.png", type: "image/png", size: 10 },
      { name: "b.pdf", type: "application/pdf", size: 10 }
    ]);
    const response = await discard(uploads.map((upload) => upload.path));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, removed: 2 });
    expect(state.removed).toEqual([uploads.map((upload) => upload.path)]);
  });

  it("never removes an object an activity already links", async () => {
    const uploads = await signAndStore([
      { name: "a.png", type: "image/png", size: 10 },
      { name: "b.png", type: "image/png", size: 10 }
    ]);
    state.usedPaths = [uploads[0]!.path];
    const response = await discard(uploads.map((upload) => upload.path));

    expect(await response.json()).toEqual({ ok: true, removed: 1 });
    expect(state.removed).toEqual([[uploads[1]!.path]]);
  });

  it("rejects paths outside the task folder without removing anything", async () => {
    const response = await discard([`${OTHER_ORG}/${TASK}/1700000000000-abcdef12-x.pdf`]);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Adjunto inválido. Volvé a adjuntar el archivo.");
    expect(state.removed).toEqual([]);
  });

  it("answers 404 for a task of another organization without removing anything", async () => {
    state.task = null;
    const response = await discard([`${ORG}/${TASK}/1700000000000-abcdef12-x.pdf`]);

    expect(response.status).toBe(404);
    expect(state.removed).toEqual([]);
  });
});
