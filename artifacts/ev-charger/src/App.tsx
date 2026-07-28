import { useRef, useEffect, useState, createContext, useContext } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/Home';
import Dashboard from '@/pages/Dashboard';
import MySpot from '@/pages/MySpot';
import Admin from '@/pages/Admin';

const allowedDomain = import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN as string | undefined;

const DomainBlockedContext = createContext(false);

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  variables: {
    colorPrimary: 'hsl(187 92% 52%)',
    colorForeground: 'hsl(210 12% 96%)',
    colorMutedForeground: 'hsl(210 8% 65%)',
    colorDanger: 'hsl(0 72% 51%)',
    colorBackground: 'hsl(220 16% 16%)',
    colorInput: 'hsl(220 14% 24%)',
    colorInputForeground: 'hsl(210 12% 96%)',
    colorNeutral: 'hsl(220 14% 22%)',
    fontFamily: 'DM Sans, system-ui, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[hsl(220_16%_16%)] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl border border-[hsl(220_14%_24%)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[hsl(210_12%_96%)] font-display font-bold',
    headerSubtitle: 'text-[hsl(210_8%_65%)]',
    socialButtonsBlockButtonText: 'text-[hsl(210_12%_96%)] font-medium',
    formFieldLabel: 'text-[hsl(210_12%_96%)] font-medium',
    footerActionLink: 'text-[hsl(187_92%_52%)] hover:text-[hsl(187_92%_60%)] font-semibold',
    footerActionText: 'text-[hsl(210_8%_65%)]',
    dividerText: 'text-[hsl(210_8%_65%)]',
    identityPreviewEditButton: 'text-[hsl(187_92%_52%)] hover:text-[hsl(187_92%_60%)]',
    formFieldSuccessText: 'text-green-400',
    alertText: 'text-[hsl(210_12%_96%)]',
    logoBox: 'mb-4',
    logoImage: 'h-12 w-auto',
    socialButtonsBlockButton: 'bg-[hsl(220_14%_24%)] border-[hsl(220_14%_28%)] text-[hsl(210_12%_96%)] hover:bg-[hsl(220_14%_28%)]',
    formButtonPrimary: 'bg-[hsl(187_92%_52%)] text-[hsl(220_18%_12%)] hover:bg-[hsl(187_92%_60%)] font-semibold',
    formFieldInput: 'bg-[hsl(220_14%_24%)] border-[hsl(220_14%_28%)] text-[hsl(210_12%_96%)]',
    footerAction: 'mt-6',
    dividerLine: 'bg-[hsl(220_14%_28%)]',
    alert: 'bg-[hsl(0_72%_51%)]/10 border-[hsl(0_72%_51%)]/30',
    otpCodeFieldInput: 'bg-[hsl(220_14%_24%)] border-[hsl(220_14%_28%)] text-[hsl(210_12%_96%)]',
    formFieldRow: 'mb-4',
    main: 'p-8',
  },
};

/** Watches for 403 API errors and signs the user out, setting the blocked flag. */
function DomainGuard({ onBlocked }: { onBlocked: () => void }) {
  const { signOut } = useClerk();
  const qc = useQueryClient();

  useEffect(() => {
    return qc.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.query.state.status === 'error') {
        const err = event.query.state.error as { status?: number } | null;
        if (err?.status === 403) {
          signOut();
          onBlocked();
        }
      }
    });
  }, [qc, signOut, onBlocked]);

  return null;
}

function SignInPage() {
  const domainBlocked = useContext(DomainBlockedContext);
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4">
      {domainBlocked && allowedDomain && (
        <div className="w-full max-w-[440px] rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Access is restricted to <strong>@{allowedDomain}</strong> accounts.
          Please sign in with your company email.
        </div>
      )}
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Dashboard />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function MySpotRoute() {
  return (
    <>
      <Show when="signed-in">
        <MySpot />
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  const [domainBlocked, setDomainBlocked] = useState(false);

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back to ChargeQ',
            subtitle: 'Sign in to manage your charging queue',
          },
        },
        signUp: {
          start: {
            title: 'Join ChargeQ',
            subtitle: allowedDomain
              ? `Sign up with your @${allowedDomain} company email`
              : 'Create an account to access the EV charger waitlist',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <DomainBlockedContext.Provider value={domainBlocked}>
            <ClerkQueryClientCacheInvalidator />
            <DomainGuard onBlocked={() => setDomainBlocked(true)} />
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/my-spot" component={MySpotRoute} />
              <Route path="/admin" component={Admin} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route component={NotFound} />
            </Switch>
            <Toaster />
          </DomainBlockedContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
