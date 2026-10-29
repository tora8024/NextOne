export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('無法連線到維修資料庫。請確認已執行 npm run dev。');
  }
  const text = await response.text();
  let payload: { error?: string } = {};
  if (text) {
    try {
      payload = JSON.parse(text) as { error?: string };
    } catch {
      throw new Error('伺服器回應無法讀取');
    }
  }
  if (!response.ok) throw new ApiError(response.status, payload.error || `請求失敗（${response.status}）`);
  return payload as T;
}
