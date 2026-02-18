import { toast as sonnerToast } from "sonner";

/**
 * Padrão de feedback UX: sucesso com mensagem amigável.
 */
export function toastSuccess(message: string, description?: string) {
  sonnerToast.success(message, { description });
}

/**
 * Padrão de feedback UX: erro com mensagem amigável + detalhe no console.
 */
export function toastError(message: string, error?: unknown, description?: string) {
  if (error !== undefined) {
    console.error("[API/UI Error]", message, error);
  }
  sonnerToast.error(message, { description: description ?? (error instanceof Error ? error.message : undefined) });
}

/**
 * Executa uma ação assíncrona e mostra toast de sucesso ou erro.
 */
export async function withToast<T>(
  promise: Promise<T>,
  options: { successMessage: string; errorMessage: string }
): Promise<T | undefined> {
  try {
    const result = await promise;
    toastSuccess(options.successMessage);
    return result;
  } catch (e) {
    toastError(options.errorMessage, e);
    return undefined;
  }
}
