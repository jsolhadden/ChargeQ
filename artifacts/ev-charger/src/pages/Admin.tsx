import { useState } from 'react';
import { useUser, useClerk } from '@clerk/react';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { Redirect, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAdminListChargers,
  useAdminListQueue,
  useAdminGetTodaySessions,
  useAdminReleaseCharger,
  useAdminRemoveQueueEntry,
  getAdminListChargersQueryKey,
  getAdminListQueueQueryKey,
  getAdminGetTodaySessionsQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Zap, LogOut, RefreshCw, Unlock, UserX, ShieldCheck } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function formatTime(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(date: string | null | undefined): string {
  if (!date) return '—';
  const d = new Date(date);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'available': return 'default';
    case 'checked_in':
    case 'occupied': return 'destructive';
    case 'assigned':
    case 'claimed': return 'secondary';
    case 'checked_out': return 'outline';
    case 'forfeited':
    case 'expired': return 'destructive';
    default: return 'outline';
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export default function Admin() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();
  const adminReady = isLoaded && !isAdminLoading;

  const { data: chargers, isLoading: chargersLoading, refetch: refetchChargers } = useAdminListChargers({
    query: { queryKey: getAdminListChargersQueryKey(), refetchInterval: 10000, enabled: isAdmin },
  });

  const { data: queue, isLoading: queueLoading, refetch: refetchQueue } = useAdminListQueue({
    query: { queryKey: getAdminListQueueQueryKey(), refetchInterval: 10000, enabled: isAdmin },
  });

  const { data: sessions, isLoading: sessionsLoading, refetch: refetchSessions } = useAdminGetTodaySessions({
    query: { queryKey: getAdminGetTodaySessionsQueryKey(), refetchInterval: 10000, enabled: isAdmin },
  });

  const releaseMutation = useAdminReleaseCharger({
    mutation: {
      onSuccess: (_, { chargerId }) => {
        setReleasingId(null);
        queryClient.invalidateQueries({ queryKey: getAdminListChargersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminGetTodaySessionsQueryKey() });
        toast({ title: 'Charger released', description: 'The charger is now free.' });
      },
      onError: (error: any) => {
        setReleasingId(null);
        toast({
          title: 'Failed to release charger',
          description: error?.message || 'Please try again',
          variant: 'destructive',
        });
      },
    },
  });

  const removeMutation = useAdminRemoveQueueEntry({
    mutation: {
      onSuccess: () => {
        setRemovingId(null);
        queryClient.invalidateQueries({ queryKey: getAdminListQueueQueryKey() });
        toast({ title: 'Queue entry removed', description: 'The user has been removed from the queue.' });
      },
      onError: (error: any) => {
        setRemovingId(null);
        toast({
          title: 'Failed to remove entry',
          description: error?.message || 'Please try again',
          variant: 'destructive',
        });
      },
    },
  });

  const handleRefresh = () => {
    refetchChargers();
    refetchQueue();
    refetchSessions();
  };

  // Wait for Clerk + admin check to load
  if (!adminReady) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Not signed in
  if (!user) {
    return <Redirect to="/" />;
  }

  // Signed in but not admin
  if (!isAdmin) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <ShieldCheck className="w-16 h-16 text-muted-foreground/40" />
        <h1 className="font-display text-2xl font-bold text-foreground">Admin Access Required</h1>
        <p className="text-muted-foreground max-w-sm">
          This area is restricted to facilities administrators. If you need access, contact your IT team.
        </p>
        <Link href="/">
          <Button variant="outline">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const isLoading = chargersLoading || queueLoading || sessionsLoading;
  const occupiedChargers = chargers?.filter((c) => c.status !== 'available') ?? [];
  const todayCompleted = sessions?.filter((s) => ['checked_out', 'forfeited', 'expired'].includes(s.status)) ?? [];
  const todayActive = sessions?.filter((s) => ['assigned', 'claimed', 'checked_in'].includes(s.status)) ?? [];

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/30 backdrop-blur-lg sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-foreground">ChargeQ</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Admin Panel
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
              className="gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ redirectUrl: basePath || '/' })}
              className="gap-1.5 text-muted-foreground"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-7xl space-y-8">
        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card/50 border-card-border">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Chargers</p>
              <p className="text-3xl font-bold text-foreground mt-1">{chargers?.length ?? '—'}</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-card-border">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">In Use</p>
              <p className="text-3xl font-bold text-foreground mt-1">{occupiedChargers.length}</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-card-border">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">In Queue</p>
              <p className="text-3xl font-bold text-foreground mt-1">{queue?.length ?? '—'}</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-card-border">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Sessions Today</p>
              <p className="text-3xl font-bold text-foreground mt-1">{sessions?.length ?? '—'}</p>
            </CardContent>
          </Card>
        </div>

        {/* Charger Management */}
        <Card className="bg-card/50 border-card-border">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Charger Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chargersLoading ? (
              <p className="text-muted-foreground text-sm py-4">Loading chargers...</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Charger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Current User</TableHead>
                    <TableHead>Session ID</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chargers?.map((charger) => (
                    <TableRow key={charger.id}>
                      <TableCell className="font-medium">{charger.name}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(charger.status)} className="capitalize">
                          {statusLabel(charger.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {charger.currentUserName ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {charger.currentSessionId ? `#${charger.currentSessionId}` : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {charger.status !== 'available' && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 text-orange-400 border-orange-400/30 hover:bg-orange-400/10"
                                disabled={releasingId === charger.id}
                              >
                                <Unlock className="w-3.5 h-3.5" />
                                {releasingId === charger.id ? 'Releasing…' : 'Force Release'}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Force Release {charger.name}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will immediately free the charger and forfeit the current session
                                  {charger.currentUserName ? ` for ${charger.currentUserName}` : ''}.
                                  The next person in queue will be assigned automatically.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-orange-500 hover:bg-orange-600 text-white"
                                  onClick={() => {
                                    setReleasingId(charger.id);
                                    releaseMutation.mutate({ chargerId: charger.id });
                                  }}
                                >
                                  Release Charger
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Queue Management */}
        <Card className="bg-card/50 border-card-border">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <UserX className="w-5 h-5 text-primary" />
              Queue Management
              {queue && queue.length > 0 && (
                <Badge variant="secondary" className="ml-auto">{queue.length} waiting</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {queueLoading ? (
              <p className="text-muted-foreground text-sm py-4">Loading queue...</p>
            ) : !queue?.length ? (
              <p className="text-muted-foreground text-sm py-4">Queue is empty.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Position</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Joined At</TableHead>
                    <TableHead>Est. Wait</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">#{entry.position}</TableCell>
                      <TableCell>{entry.userName}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{entry.userEmail}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatTime(entry.joinedAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {entry.estimatedWaitMinutes != null ? `~${entry.estimatedWaitMinutes}m` : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-red-400 border-red-400/30 hover:bg-red-400/10"
                              disabled={removingId === entry.id}
                            >
                              <UserX className="w-3.5 h-3.5" />
                              {removingId === entry.id ? 'Removing…' : 'Remove'}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {entry.userName} from queue?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will cancel their queue entry. They will need to rejoin the queue if
                                they still want a charger.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-red-500 hover:bg-red-600 text-white"
                                onClick={() => {
                                  setRemovingId(entry.id);
                                  removeMutation.mutate({ entryId: entry.id });
                                }}
                              >
                                Remove from Queue
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Today's Session Log */}
        <Card className="bg-card/50 border-card-border">
          <CardHeader>
            <CardTitle className="font-display text-lg">
              Today's Session Log
              <span className="text-muted-foreground font-normal text-sm ml-2">
                {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <p className="text-muted-foreground text-sm py-4">Loading sessions...</p>
            ) : !sessions?.length ? (
              <p className="text-muted-foreground text-sm py-4">No sessions today yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Charger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Checked In</TableHead>
                    <TableHead>Checked Out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="text-muted-foreground text-sm">#{session.id}</TableCell>
                      <TableCell className="font-medium">{session.userName}</TableCell>
                      <TableCell>{session.chargerName}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(session.status)} className="capitalize">
                          {statusLabel(session.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatTime(session.assignedAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatTime(session.checkedInAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatTime(session.checkedOutAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
