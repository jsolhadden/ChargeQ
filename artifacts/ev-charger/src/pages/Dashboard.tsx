import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Show, useClerk, useUser } from '@clerk/react';
import { LogOut, Zap, ArrowRight } from 'lucide-react';
import {
  useListChargers,
  useListQueue,
  useGetMyQueueEntry,
  useGetDashboardSummary,
  useJoinQueue,
  useLeaveQueue,
  useClaimDirectSession,
  getListChargersQueryKey,
  getListQueueQueryKey,
  getGetMyQueueEntryQueryKey,
  getGetDashboardSummaryQueryKey,
} from '@workspace/api-client-react';
import { ChargerStatusCard } from '@/components/ChargerStatusCard';
import { QueueList } from '@/components/QueueList';
import { DashboardStats } from '@/components/DashboardStats';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Link, Redirect } from 'wouter';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [takingChargerId, setTakingChargerId] = useState<number | null>(null);

  const { data: chargers, isLoading: chargersLoading } = useListChargers({
    query: {
      queryKey: getListChargersQueryKey(),
      refetchInterval: 5000,
    },
  });

  const { data: queue, isLoading: queueLoading } = useListQueue({
    query: {
      queryKey: getListQueueQueryKey(),
      refetchInterval: 5000,
    },
  });

  const { data: myStatus, isLoading: myStatusLoading } = useGetMyQueueEntry({
    query: {
      queryKey: getGetMyQueueEntryQueryKey(),
      refetchInterval: 5000,
    },
  });

  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({
    query: {
      queryKey: getGetDashboardSummaryQueryKey(),
      refetchInterval: 5000,
    },
  });

  const joinQueueMutation = useJoinQueue({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyQueueEntryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        toast({
          title: 'Joined queue',
          description: "You'll be notified when a charger is available.",
        });
      },
      onError: (error: any) => {
        toast({
          title: 'Failed to join queue',
          description: error?.message || 'Please try again',
          variant: 'destructive',
        });
      },
    },
  });

  const leaveQueueMutation = useLeaveQueue({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyQueueEntryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        toast({
          title: 'Left queue',
          description: 'You can rejoin at any time.',
        });
      },
      onError: (error: any) => {
        toast({
          title: 'Failed to leave queue',
          description: error?.message || 'Please try again',
          variant: 'destructive',
        });
      },
    },
  });

  const claimDirectMutation = useClaimDirectSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListChargersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyQueueEntryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setTakingChargerId(null);
        // myStatus will update to 'assigned' → Dashboard redirects to /my-spot automatically
      },
      onError: (error: any) => {
        setTakingChargerId(null);
        const msg = error?.response?.data?.error || error?.message || 'Please try again';
        toast({
          title: 'Charger unavailable',
          description: msg,
          variant: 'destructive',
        });
        // Refresh charger list so stale availability clears
        queryClient.invalidateQueries({ queryKey: getListChargersQueryKey() });
      },
    },
  });

  const handleTakeCharger = (chargerId: number) => {
    setTakingChargerId(chargerId);
    claimDirectMutation.mutate({ data: { chargerId } });
  };

  const handleJoinQueue = () => {
    joinQueueMutation.mutate({ data: {} });
  };

  const handleLeaveQueue = () => {
    if (myStatus?.queueEntry?.id) {
      leaveQueueMutation.mutate({ entryId: myStatus.queueEntry.id });
    }
  };

  // Redirect to /my-spot if user has an active session
  // Note: 'claimed' DB status is returned as state 'assigned' by the API,
  // so this redirect covers assigned, claimed, and checked_in sessions.
  if (myStatus?.state === 'assigned' && myStatus.session?.claimedAt == null) {
    return <Redirect to="/my-spot" />;
  }

  const isLoading = chargersLoading || queueLoading || myStatusLoading || summaryLoading;
  const inQueue = myStatus?.state === 'waiting';
  const isNotInQueue = myStatus?.state === 'not_in_queue';
  const anyChargerAvailable = chargers?.some((c) => c.status === 'available') ?? false;
  const allChargersBusy = !anyChargerAvailable;
  // Show "Join Waitlist" only when every charger is occupied/assigned
  const canJoinQueue = isNotInQueue && allChargersBusy;

  const userInitials = user?.firstName && user?.lastName 
    ? `${user.firstName[0]}${user.lastName[0]}` 
    : user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || '?';

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
              <p className="text-xs text-muted-foreground">EV Waitlist</p>
            </div>
          </Link>

          <Show when="signed-in">
            {/* Visible during the loading window and if user navigates back */}
            {myStatusLoading && (
              <Link href="/my-spot">
                <Button size="sm" variant="outline" className="gap-1.5 mr-2">
                  <Zap className="w-3.5 h-3.5" />
                  My Spot
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full" data-testid="button-user-menu">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={user?.imageUrl} alt={user?.fullName || ''} />
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="font-semibold">{user?.fullName || 'User'}</span>
                    <span className="text-xs text-muted-foreground">{user?.emailAddresses?.[0]?.emailAddress}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut({ redirectUrl: basePath || '/' })}
                  className="text-red-400 focus:text-red-400 cursor-pointer"
                  data-testid="button-logout"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Show>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        {isLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading dashboard...</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Stats */}
            {summary && <DashboardStats summary={summary} />}

            {/* Chargers Grid */}
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground mb-4">Charger Status</h2>
              <div className="grid md:grid-cols-2 gap-4">
                {chargers?.map((charger) => (
                  <ChargerStatusCard
                    key={charger.id}
                    charger={charger}
                    onTake={isNotInQueue ? handleTakeCharger : undefined}
                    isTaking={takingChargerId === charger.id}
                    canTake={isNotInQueue && !claimDirectMutation.isPending}
                  />
                ))}
              </div>
            </div>

            {/* Queue Controls */}
            <Card className="p-6 border-card-border bg-card/50 backdrop-blur-sm">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h3 className="font-display text-xl font-bold text-foreground">Your Status</h3>
                  {inQueue ? (
                    <p className="text-sm text-muted-foreground mt-1">
                      Position #{myStatus?.queueEntry?.position} in queue
                      {myStatus?.queueEntry?.estimatedWaitMinutes && (
                        <> • ~{myStatus.queueEntry.estimatedWaitMinutes}m wait</>
                      )}
                    </p>
                  ) : isNotInQueue && anyChargerAvailable ? (
                    <p className="text-sm text-muted-foreground mt-1">
                      Pick an available charger above ↑
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-1">
                      All chargers are busy — join the waitlist to be next in line
                    </p>
                  )}
                </div>
                <div>
                  {canJoinQueue && (
                    <Button
                      onClick={handleJoinQueue}
                      disabled={joinQueueMutation.isPending}
                      size="lg"
                      className="font-semibold"
                      data-testid="button-join-queue"
                    >
                      {joinQueueMutation.isPending ? 'Joining...' : 'Join Waitlist'}
                    </Button>
                  )}
                  {inQueue && (
                    <Button
                      onClick={handleLeaveQueue}
                      disabled={leaveQueueMutation.isPending}
                      variant="outline"
                      size="lg"
                      className="font-semibold"
                      data-testid="button-leave-queue"
                    >
                      {leaveQueueMutation.isPending ? 'Leaving...' : 'Leave Waitlist'}
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            {/* Queue List */}
            {queue && <QueueList queue={queue} currentUserId={user?.id} />}
          </div>
        )}
      </main>
    </div>
  );
}
