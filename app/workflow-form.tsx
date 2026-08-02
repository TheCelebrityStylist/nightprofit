"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthLocale } from "./auth-locale";

type Field = {
  name: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "number"
    | "date"
    | "datetime-local"
    | "select"
    | "textarea";
  required?: boolean;
  options?: { label: string; value: string }[];
  placeholder?: string;
};

export function WorkflowForm({
  organisationId,
  workflow,
  title,
  submitLabel,
  fields,
  endpoint = "/api/workflows",
}: {
  organisationId: string;
  workflow: string;
  title: string;
  submitLabel: string;
  fields: Field[];
  endpoint?: string;
}) {
  const { t, locale } = useAuthLocale();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(formData: FormData) {
    setPending(true);
    setError("");
    setSuccess("");
    const values = Object.fromEntries(formData.entries());
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        ["/api/planning", "/api/workforce"].includes(endpoint)
          ? { action: workflow, organisationId, locale: locale === "nl" ? "nl-NL" : "en-US", values }
          : { workflow, organisationId, locale: locale === "nl" ? "nl-NL" : "en-US", values },
      ),
    });
    await response.json() as {
      error?: string;
      message?: string;
    };
    setPending(false);
    if (!response.ok) {
      setError(t("common.saveFailed"));
      return;
    }
    setSuccess(t("common.saved"));
    router.refresh();
  }

  return (
    <form className="workflow-card" action={submit}>
      <h3>{title}</h3>
      <div className="workflow-fields">
        {fields.map((field) => (
          <label key={field.name}>
            {field.label}
            {field.type === "select" ? (
              <select
                name={field.name}
                required={field.required}
                defaultValue=""
              >
                <option value="" disabled>
                  {t("common.choose")}
                </option>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                name={field.name}
                required={field.required}
                placeholder={field.placeholder}
                rows={3}
              />
            ) : (
              <input
                name={field.name}
                type={field.type ?? "text"}
                step={field.type === "number" ? "any" : undefined}
                required={field.required}
                placeholder={field.placeholder}
              />
            )}
          </label>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="form-success" role="status">
          {success}
        </p>
      )}
      <button className="primary" disabled={pending} aria-busy={pending}>
        {pending ? t("common.saving") : submitLabel}
      </button>
    </form>
  );
}
