"use client";

import { useCallback, useEffect, useState } from "react";

interface Attachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSizeBytes: number;
  createdAt: string;
}

interface FileUploadProps {
  entityType: "lead" | "invoice";
  entityId: string;
}

const fmtSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function FileUpload({ entityType, entityId }: FileUploadProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAttachments = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/uploads?entityType=${entityType}&entityId=${entityId}`, { signal });
      if (signal?.aborted) return;
      if (res.ok) {
        const data = await res.json();
        setAttachments(data.data);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }, [entityType, entityId]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitial() {
      await loadAttachments(controller.signal);
    }

    void loadInitial();
    return () => controller.abort();
  }, [loadAttachments]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError("File must be under 2 MB");
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("entityType", entityType);
      form.append("entityId", entityId);
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
        return;
      }
      setAttachments((prev) => [...prev, data.data]);
    } catch {
      setError("Upload failed - network error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="cursor-pointer">
          <span className="inline-flex min-h-8 items-center rounded-lg border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50">
            {uploading ? "Uploading..." : "Attach file"}
          </span>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleFileChange} disabled={uploading} className="sr-only" />
        </label>
        <span className="text-xs text-gray-400">Optional supporting docs: PDF, PNG, JPG - max 2 MB</span>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {attachments.length > 0 && (
        <ul className="space-y-1">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
              <div>
                <a href={attachment.fileUrl} target="_blank" rel="noreferrer" className="font-medium text-gray-800 hover:underline">
                  {attachment.fileName}
                </a>
                <span className="ml-2 text-xs text-gray-400">{fmtSize(attachment.fileSizeBytes)}</span>
              </div>
              <span className="text-xs uppercase text-gray-400">{attachment.fileType}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
