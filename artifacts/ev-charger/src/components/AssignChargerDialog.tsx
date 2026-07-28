import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getAdminListChargersQueryKey, getAdminGetTodaySessionsQueryKey } from '@workspace/api-client-react';
import { UserPlus, Search } from 'lucide-react';

interface ClerkUser {
  id: string;
  name: string;
  email: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chargerId: number;
  chargerName: string;
}

export function AssignChargerDialog({ open, onOpenChange, chargerId, chargerName }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [mode, setMode] = useState<'registered' | 'generic'>('registered');
  const [users, setUsers] = useState<ClerkUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<ClerkUser | null>(null);
  const [genericName, setGenericName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch user list when dialog opens in registered mode
  useEffect(() => {
    if (!open || mode !== 'registered') return;
    setUsersLoading(true);
    fetch('/api/admin/users', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setUsers(data))
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, [open, mode]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setMode('registered');
      setSearch('');
      setSelectedUser(null);
      setGenericName('');
    }
  }, [open]);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const canSubmit = mode === 'registered' ? !!selectedUser : genericName.trim().length > 0;

  async function handleAssign() {
    setSubmitting(true);
    try {
      const body =
        mode === 'registered'
          ? { userId: selectedUser!.id, userName: selectedUser!.name }
          : { userName: genericName.trim() };

      const res = await fetch(`/api/admin/chargers/${chargerId}/assign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to assign');
      }

      queryClient.invalidateQueries({ queryKey: getAdminListChargersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getAdminGetTodaySessionsQueryKey() });
      toast({ title: 'Charger assigned', description: `${body.userName} is now using ${chargerName}.` });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Assignment failed', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Assign Occupant — {chargerName}
          </DialogTitle>
          <DialogDescription>
            Place someone on this charger directly. The session starts as checked-in immediately.
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setMode('registered')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === 'registered'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            Registered User
          </button>
          <button
            type="button"
            onClick={() => setMode('generic')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === 'generic'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            Walk-in / Generic
          </button>
        </div>

        {mode === 'registered' ? (
          <div className="space-y-3">
            {/* Search box */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSelectedUser(null); }}
                className="pl-9"
              />
            </div>

            {/* User list */}
            <div className="max-h-52 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {usersLoading ? (
                <p className="text-sm text-muted-foreground p-3">Loading users…</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3">No users found.</p>
              ) : (
                filtered.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setSelectedUser(u)}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                      selectedUser?.id === u.id
                        ? 'bg-primary/15 text-primary'
                        : 'hover:bg-muted/50 text-foreground'
                    }`}
                  >
                    <span className="font-medium">{u.name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{u.email}</span>
                  </button>
                ))
              )}
            </div>
            {selectedUser && (
              <p className="text-xs text-primary">
                Selected: <span className="font-medium">{selectedUser.name}</span>
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="generic-name">Display name</Label>
            <Input
              id="generic-name"
              placeholder="e.g. Walk-in, Visitor, John D."
              value={genericName}
              onChange={(e) => setGenericName(e.target.value)}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={!canSubmit || submitting}>
            {submitting ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
