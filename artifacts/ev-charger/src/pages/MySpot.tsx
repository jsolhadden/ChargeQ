import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Show, useClerk, useUser } from '@clerk/react';
import { LogOut, Zap, ArrowLeft, CheckCircle, Clock } from 'lucide-react';
import {
  useGetMyQueueEntry,
  useClaimSession,
  useCheckInSession,
  useCheckOutSession,
  useCancelSession,
  getGetMyQueueEntryQueryKey,
  getListChargersQueryKey,
  getListQueueQueryKey,
  getGetDashboardSummaryQueryKey,
} from '@workspace/api-client-react';
import { CountdownTimer } from '@/components/CountdownTimer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

export default function MySpot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { signOut } = useClerk();
  const { user } = useUser();

  const { data: myStatus, isLoading } = useGetMyQueueEntry({
    query: {
      queryKey: getGetMyQueueEntryQueryKey(),
      refetchInterval: 3000,
    },
  });

  const cancelSessionMutation = useCancelSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyQueueEntryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListChargersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        toast({
          title: 'Reservation cancelled',
          description: 'Your spot has been released.',
        });
      },
      onError: (error: any) => {
        toast({
          title: 'Could not cancel',
          description: error?.message || 'Please try again',
          variant: 'destructive',
        });
      },
    },
  });

  const claimSessionMutation = useClaimSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyQueueEntryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListChargersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        toast({
          title: 'Charger claimed!',
          description: 'Head to your assigned spot and check in when ready.',
        });
      },
      onError: (error: any) => {
        toast({
          title: 'Failed to claim',
          description: error?.message || 'The claim window may have expired',
          variant: 'destructive',
        });
      },
    },
  });

  const checkInMutation = useCheckInSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyQueueEntryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListChargersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        toast({
          title: 'Checked in!',
          description: 'Enjoy your charging session.',
        });
      },
      onError: (error: any) => {
        toast({
          title: 'Check-in failed',
          description: error?.message || 'Please try again',
          variant: 'destructive',
        });
      },
    },
  });

  const checkOutMutation = useCheckOutSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyQueueEntryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListChargersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        toast({
          title: 'Checked out',
          description: 'Thanks for using ChargeQ!',
        });
      },
      onError: (error: any) => {
        toast({
          title: 'Check-out failed',
          description: error?.message || 'Please try again',
          variant: 'destructive',
        });
      },
    },
  });

  const handleCancel = () => {
    if (myStatus?.session?.id) {
      cancelSessionMutation.mutate({ sessionId: myStatus.session.id });
    }
  };

  const handleClaim = () => {
    if (myStatus?.session?.id) {
      claimSessionMutation.mutate({ sessionId: myStatus.session.id });
    }
  };

  const handleCheckIn = () => {
    if (myStatus?.session?.id) {
      checkInMutation.mutate({ sessionId: myStatus.session.id });
    }
  };

  const handleCheckOut = () => {
    if (myStatus?.session?.id) {
      checkOutMutation.mutate({ sessionId: myStatus.session.id });
    }
  };

  // Redirect to dashboard if no active session
  if (!isLoading && (!myStatus?.session || myStatus.state === 'not_in_queue' || myStatus.state === 'waiting')) {
    return <Redirect to="/" />;
  }

  const session = myStatus?.session;
  const statusConfig = {
    assigned: {
      title: 'Charger Assigned',
      description: 'Claim your spot within the time limit',
      color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      action: 'Claim Spot',
      showTimer: true,
    },
    claimed: {
      title: 'Spot Claimed',
      description: 'Head to your charger and check in when parked',
      color: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      action: 'Check In',
      showTimer: false,
    },
    checked_in: {
      title: 'Charging Active',
      description: 'Check out when finished to free the spot',
      color: 'bg-green-500/20 text-green-400 border-green-500/30',
      action: 'Check Out',
      showTimer: false,
    },
  };

  const config = session?.status ? statusConfig[session.status as keyof typeof statusConfig] : null;

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

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {isLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading session...</p>
            </div>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Back to dashboard
            </Link>

            <Card className="border-card-border bg-card/50 backdrop-blur-sm overflow-hidden">
              <div className="p-8">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    {config && (
                      <Badge variant="outline" className={`mb-3 ${config.color}`} data-testid="session-status">
                        {config.title}
                      </Badge>
                    )}
                    <h1 className="font-display text-4xl font-bold text-foreground mb-2" data-testid="charger-name">
                      {session?.chargerName}
                    </h1>
                    {config && (
                      <p className="text-muted-foreground">{config.description}</p>
                    )}
                  </div>
                  <div className="p-4 rounded-xl bg-primary/10">
                    <Zap className="w-8 h-8 text-primary" />
                  </div>
                </div>

                {session?.status === 'assigned' && session.claimDeadlineAt && config?.showTimer && (
                  <div className="mb-6 p-4 rounded-xl bg-muted/30 border border-border">
                    <p className="text-sm text-muted-foreground mb-3 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Time remaining to claim
                    </p>
                    <CountdownTimer
                      deadlineAt={session.claimDeadlineAt}
                      onExpired={() => {
                        toast({
                          title: 'Claim window expired',
                          description: 'Your spot has been released to the next person in queue.',
                          variant: 'destructive',
                        });
                      }}
                    />
                  </div>
                )}

                <div className="space-y-3">
                  {session?.status === 'assigned' && (
                    <>
                      <Button
                        onClick={handleClaim}
                        disabled={claimSessionMutation.isPending || cancelSessionMutation.isPending}
                        size="lg"
                        className="w-full font-semibold text-lg h-14"
                        data-testid="button-claim"
                      >
                        {claimSessionMutation.isPending ? 'Claiming...' : config?.action}
                      </Button>
                      <Button
                        onClick={handleCancel}
                        disabled={cancelSessionMutation.isPending || claimSessionMutation.isPending}
                        size="lg"
                        variant="ghost"
                        className="w-full font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        data-testid="button-cancel-reservation"
                      >
                        {cancelSessionMutation.isPending ? 'Cancelling...' : "I don't need this spot"}
                      </Button>
                    </>
                  )}

                  {session?.status === 'claimed' && (
                    <Button
                      onClick={handleCheckIn}
                      disabled={checkInMutation.isPending}
                      size="lg"
                      className="w-full font-semibold text-lg h-14"
                      data-testid="button-checkin"
                    >
                      <CheckCircle className="w-5 h-5 mr-2" />
                      {checkInMutation.isPending ? 'Checking in...' : config?.action}
                    </Button>
                  )}

                  {session?.status === 'checked_in' && (
                    <Button
                      onClick={handleCheckOut}
                      disabled={checkOutMutation.isPending}
                      size="lg"
                      variant="outline"
                      className="w-full font-semibold text-lg h-14"
                      data-testid="button-checkout"
                    >
                      {checkOutMutation.isPending ? 'Checking out...' : config?.action}
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            {session?.status === 'checked_in' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <Card className="p-6 border-green-500/30 bg-green-500/5">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-green-500/20">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Charging in progress</h3>
                      <p className="text-sm text-muted-foreground">
                        Remember to check out when you're done to help the next person in queue.
                      </p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}
          </motion.div>
        )}
      </main>
    </div>
  );
}
