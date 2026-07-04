import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuth, type AuthUser } from './useAuth';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const user: AuthUser = {
  id: 1,
  email: 'a@b.c',
  name: 'A',
  displayName: 'A',
  initials: 'A',
  avatarUrl: null,
  status: 'AVAILABLE',
  role: 'ADMIN',
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
  useAuth.setState({ user: null, ready: false });
});

describe('useAuth', () => {
  it('login : stocke le token et l’utilisateur', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ token: 'jwt-1', user }));
    await useAuth.getState().login('a@b.c', 'pw');
    expect(localStorage.getItem('token')).toBe('jwt-1');
    expect(useAuth.getState().user?.email).toBe('a@b.c');
  });

  it('logout : purge token et utilisateur', () => {
    localStorage.setItem('token', 'jwt-1');
    useAuth.setState({ user });
    useAuth.getState().logout();
    expect(localStorage.getItem('token')).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('init sans token : ready sans appel réseau', async () => {
    await useAuth.getState().init();
    expect(useAuth.getState().ready).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('init avec token valide : restaure la session', async () => {
    localStorage.setItem('token', 'jwt-1');
    mockFetch.mockResolvedValue(jsonResponse({ user }));
    await useAuth.getState().init();
    expect(useAuth.getState().user?.id).toBe(1);
    expect(useAuth.getState().ready).toBe(true);
  });

  it('init avec token invalide : purge le token, ready quand même', async () => {
    localStorage.setItem('token', 'périmé');
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Token invalide' }, 401));
    await useAuth.getState().init();
    expect(localStorage.getItem('token')).toBeNull();
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().ready).toBe(true);
  });
});
