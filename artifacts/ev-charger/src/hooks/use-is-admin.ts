import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';

async function fetchIsAdmin(): Promise<boolean> {
  const res = await fetch('/api/admin/me', { credentials: 'include' });
  return res.ok;
}

export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { isSignedIn } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: fetchIsAdmin,
    enabled: !!isSignedIn,
    staleTime: Infinity,
    retry: false,
  });

  return { isAdmin: data ?? false, isLoading };
}
