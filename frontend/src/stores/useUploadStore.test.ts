import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useUploadStore } from './useUploadStore';
import { uploadMedia } from '../lib/uploadClient';

// Le store délègue le flux réseau à uploadClient : on le simule intégralement.
vi.mock('../lib/uploadClient', () => ({
  uploadMedia: vi.fn(),
  inferMediaKind: () => 'IMAGE' as const,
}));
const uploadMediaMock = vi.mocked(uploadMedia);

const flush = () => new Promise((r) => setTimeout(r, 0));
const file = new File(['x'], 'plan.png', { type: 'image/png' });

beforeEach(() => {
  uploadMediaMock.mockReset();
  useUploadStore.setState({ uploads: [] });
});

describe('useUploadStore', () => {
  it('enqueue → done : progression puis mediaObjectId', async () => {
    uploadMediaMock.mockImplementation(async (_f, _v, opts) => {
      opts?.onProgress?.(50);
      opts?.onProgress?.(100);
      return { mediaObjectId: 42, status: 'READY' };
    });
    const id = useUploadStore.getState().enqueue(file, 7);
    expect(useUploadStore.getState().uploads).toHaveLength(1);
    await flush();
    const u = useUploadStore.getState().uploads.find((x) => x.id === id)!;
    expect(u.status).toBe('done');
    expect(u.progress).toBe(100);
    expect(u.mediaObjectId).toBe(42);
    expect(u.versionId).toBe(7);
  });

  it('enqueue → error : le message d’échec est conservé', async () => {
    uploadMediaMock.mockRejectedValue(new Error('PUT 403'));
    const id = useUploadStore.getState().enqueue(file, 7);
    await flush();
    const u = useUploadStore.getState().uploads.find((x) => x.id === id)!;
    expect(u.status).toBe('error');
    expect(u.error).toBe('PUT 403');
  });

  it('activeCount ne compte que les uploads non terminés', async () => {
    uploadMediaMock.mockResolvedValue({ mediaObjectId: 1, status: 'READY' });
    useUploadStore.getState().enqueue(file, 1);
    expect(useUploadStore.getState().activeCount()).toBe(1);
    await flush();
    expect(useUploadStore.getState().activeCount()).toBe(0);
  });

  it('clearCompleted retire uniquement les uploads terminés', async () => {
    uploadMediaMock.mockResolvedValueOnce({ mediaObjectId: 1, status: 'READY' });
    uploadMediaMock.mockRejectedValueOnce(new Error('boom'));
    useUploadStore.getState().enqueue(file, 1);
    useUploadStore.getState().enqueue(file, 2);
    await flush();
    useUploadStore.getState().clearCompleted();
    const statuses = useUploadStore.getState().uploads.map((u) => u.status);
    expect(statuses).toEqual(['error']);
  });
});
