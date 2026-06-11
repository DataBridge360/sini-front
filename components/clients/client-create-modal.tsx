"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { LocalityCombobox } from "@/components/ui/selects";

export function ClientCreateModal({
  isOpen,
  isCreating,
  onClose,
  onCreate
}: {
  isOpen: boolean;
  isCreating: boolean;
  onClose: () => void;
  onCreate: (body: Record<string, FormDataEntryValue>) => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  return (
    <Modal title="Nuevo asegurado" isOpen={isOpen} onClose={close}>
      <form
        className="sp-form sp-modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          const formElement = event.currentTarget;
          try {
            await onCreate(Object.fromEntries(new FormData(formElement)));
            formElement.reset();
            close();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "No se pudo crear el asegurado.");
          }
        }}
      >
        <div className="sp-form-section">
          <h3>Datos personales</h3>
          <label className="sp-field"><span>Nombre completo</span><input name="fullName" placeholder="Nombre y apellido" required /></label>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field"><span>Teléfono</span><input name="phone" placeholder="Teléfono" /></label>
          <label className="sp-field"><span>Email</span><input name="email" type="email" placeholder="correo@dominio.com" /></label>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field"><span>DNI</span><input name="dni" placeholder="Documento" /></label>
          <LocalityCombobox name="locality" />
        </div>
        {error ? <div className="sp-pay-error">{error}</div> : null}
        <div className="sp-modal-actions">
          <button className="sp-secondary-action" type="button" onClick={close} disabled={isCreating}>Cancelar</button>
          <button className="sp-primary-action" type="submit" disabled={isCreating}>
            {isCreating ? <span className="sp-button-spinner" aria-hidden="true" /> : <Plus size={14} />}
            {isCreating ? "Cargando..." : "Agregar asegurado"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

