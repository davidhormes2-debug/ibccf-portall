import { toast } from "@/hooks/use-toast";

export interface AppError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
}

export function parseApiError(error: unknown): AppError {
  if (error instanceof Response) {
    return {
      message: `Request failed with status ${error.status}`,
      status: error.status,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      details: error,
    };
  }

  if (typeof error === "object" && error !== null) {
    const errorObj = error as Record<string, unknown>;
    return {
      message: (errorObj.message as string) || "An unknown error occurred",
      code: errorObj.code as string,
      status: errorObj.status as number,
      details: errorObj,
    };
  }

  return {
    message: typeof error === "string" ? error : "An unknown error occurred",
  };
}

export function getErrorMessage(error: unknown): string {
  const parsed = parseApiError(error);
  return parsed.message;
}

export function showErrorToast(error: unknown, title = "Error"): void {
  const message = getErrorMessage(error);
  toast({
    title,
    description: message,
    variant: "destructive",
  });
}

export function showSuccessToast(message: string, title = "Success"): void {
  toast({
    title,
    description: message,
  });
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError") ||
      error.message.includes("Network request failed")
    );
  }
  return false;
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("timeout") || error.name === "AbortError";
  }
  return false;
}

export function isUnauthorizedError(error: unknown): boolean {
  const parsed = parseApiError(error);
  return parsed.status === 401;
}

export function isForbiddenError(error: unknown): boolean {
  const parsed = parseApiError(error);
  return parsed.status === 403;
}

export function isNotFoundError(error: unknown): boolean {
  const parsed = parseApiError(error);
  return parsed.status === 404;
}

export function isServerError(error: unknown): boolean {
  const parsed = parseApiError(error);
  return (parsed.status ?? 0) >= 500;
}

export async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }
    
    const error = {
      ...(typeof errorData === "object" ? errorData : { message: errorData }),
      status: response.status,
    };
    throw error;
  }
  
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json();
  }
  return response.text() as unknown as T;
}

export function logError(error: unknown, context?: string): void {
  const parsed = parseApiError(error);
  console.error(`[${context || "Error"}]`, {
    message: parsed.message,
    code: parsed.code,
    status: parsed.status,
    details: parsed.details,
  });
}

export function createRetryHandler(
  fn: () => Promise<void>,
  maxRetries = 3,
  delay = 1000
): () => Promise<void> {
  return async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await fn();
        return;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
        }
      }
    }
    throw lastError;
  };
}
