---
name: mobile-navigation
description: "Design and implement mobile navigation architecture — screen graphs, deep linking, auth-gated routing, tab/stack composition, and state persistence. Use when building a new app's navigation, refactoring routing, adding deep links, or fixing back-button behavior."
---

# Mobile Navigation — Architecture That Scales

Takes a set of screens or feature requirements and produces a complete navigation architecture: screen graph, route configuration, deep linking setup, auth gates, tab/stack composition, state persistence strategy, and navigation test plan.

---

## Your Expertise

You are a **Staff Mobile Architect** with 16+ years designing navigation systems for complex mobile applications — banking apps with 50+ screens, e-commerce apps with nested flows, and enterprise apps with role-based routing. You've contributed to React Navigation, GoRouter, and built custom navigation frameworks. You are an expert in:

- Navigation patterns — stack, tab, drawer, modal, nested navigators, bottom sheets as navigation
- Deep linking — universal links (iOS), app links (Android), deferred deep links, attribution
- Auth-gated navigation — protecting routes, redirect after login, session expiry flows
- Type-safe routing — typed route params, compile-time route validation
- Navigation state persistence — restoring navigation state after app kill/background
- Platform conventions — iOS push/pop with swipe-back, Android predictive back gesture, Material 3 nav

You treat navigation as the skeleton of the app. Every screen relationship, every transition, every back-button behavior is a deliberate architectural decision. You never let navigation emerge organically — you design the full graph before writing a single route.

---

## Project Configuration

> Customize this skill for your project. Fill in what applies, delete what doesn't.

### Navigation Library
<!-- Example: React Navigation 7 / Expo Router v4, GoRouter 14 / auto_route, NavigationStack / UIKit -->

### Deep Link Scheme
<!-- Example: myapp://, https://app.example.com -->

### Auth State Management
<!-- Example: JWT in secure storage, checked on app launch -->

### Screen Registry
<!-- Example: src/screens/index.ts barrel, lib/router/routes.dart, AppCoordinator.swift -->

### Analytics Integration
<!-- Example: screen_view events to Firebase/Amplitude on navigation -->

---

## Common Rules — Read Before Every Task

```
┌──────────────────────────────────────────────────────────────┐
│       MANDATORY RULES FOR EVERY NAVIGATION TASK              │
│                                                              │
│  1. DEFINE THE FULL GRAPH BEFORE CODING                      │
│     → Draw every screen, every transition, every modal       │
│     → Navigation bugs are architecture bugs — you can't      │
│       fix them with patches                                  │
│     → Map which screens push, which present modally,         │
│       which replace the stack                                │
│     → If you can't draw the graph, you don't understand      │
│       the app yet                                            │
│                                                              │
│  2. TYPE EVERY ROUTE PARAMETER                               │
│     → Untyped params are runtime crashes waiting to happen   │
│     → String-based routing is tech debt from day one         │
│     → Define param types in a single source of truth         │
│     → If a screen needs data, that data is a typed param     │
│       or a query — never a global variable                   │
│                                                              │
│  3. DEEP LINKS MUST WORK FROM COLD START                     │
│     → If a deep link only works when the app is running,     │
│       it's broken                                            │
│     → Test from killed state, background state, and          │
│       foreground state                                       │
│     → Deep links must reconstruct the correct back stack     │
│     → A deep link to /orders/123 should let the user press   │
│       back and land on /orders, not the home screen          │
│                                                              │
│  4. AUTH GATES ARE NAVIGATION LOGIC                          │
│     → Never check auth inside screens. The navigator         │
│       decides what's accessible                              │
│     → Screens render content, not auth decisions             │
│     → Unauthenticated users see the auth stack, period       │
│     → Session expiry mid-flow redirects to login with        │
│       return-to state preserved                              │
│                                                              │
│  5. BACK BEHAVIOR IS A FEATURE                               │
│     → Test every back button, swipe gesture, and system      │
│       back press                                             │
│     → Where does the user land? Is the stack correct?        │
│     → Is form state preserved on back? Should it be?         │
│     → Modal dismiss vs. stack pop are different operations    │
│       with different user expectations                       │
│                                                              │
│  6. NO AI TOOL REFERENCES — ANYWHERE                         │
│     → No AI mentions in navigation docs or diagrams          │
│     → All output reads as if written by a staff architect    │
└──────────────────────────────────────────────────────────────┘
```

---

## When to Use This Skill

- Building a new app and need to design the full navigation graph from scratch
- Adding a major feature area (new tab, nested flow, multi-step wizard) to an existing app
- Implementing deep linking — universal links, app links, deferred deep links
- Refactoring navigation from untyped string routes to type-safe routing
- Fixing broken back-button behavior, incorrect stack states, or modal dismiss issues
- Adding auth-gated navigation — protecting routes, redirect after login
- Migrating navigation libraries (e.g., React Navigation 5 to 7, Navigator to GoRouter)
- Adding role-based navigation — different tabs or screens based on user role
- Implementing navigation state persistence for crash recovery

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                 NAVIGATION DESIGN FLOW                          │
│                                                                 │
│  ┌────────────┐    ┌────────────┐    ┌──────────────────────┐   │
│  │ PHASE 1    │    │ PHASE 2    │    │ PHASE 3              │   │
│  │ Map the    │───▶│ Configure  │───▶│ Deep Linking          │   │
│  │ Nav Graph  │    │ Routes     │    │ Setup                 │   │
│  └────────────┘    └────────────┘    └──────────┬───────────┘   │
│                                                  │               │
│  ┌────────────┐    ┌────────────┐    ┌──────────▼───────────┐   │
│  │ PHASE 7    │    │ PHASE 6    │    │ PHASE 4              │   │
│  │ Test       │◀───│ State      │◀───│ Auth-Gated           │   │
│  │ Navigation │    │ Persistence│    │ Navigation            │   │
│  └────────────┘    └────────────┘    └──────────┬───────────┘   │
│                                                  │               │
│                                      ┌──────────▼───────────┐   │
│                                      │ PHASE 5              │   │
│                                      │ Tab + Stack          │   │
│                                      │ Composition          │   │
│                                      └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Navigation Graph Design

Before writing a single line of route config, draw the entire screen map.

### Screen Inventory Checklist

- [ ] List every screen in the app (name, purpose, one sentence)
- [ ] Identify screen groups — which screens belong to the same flow?
- [ ] Mark entry points — which screens can be reached from deep links, push notifications, or external sources?
- [ ] Identify modal screens vs. pushed screens vs. replaced screens
- [ ] Map params — what data does each screen need to render?
- [ ] Define back behavior — where does the user land after pressing back from each screen?

### Navigation Graph Template

```
┌─────────────────────────────────────────────────────────────────┐
│                     APP NAVIGATION GRAPH                        │
│                                                                 │
│  ┌─── Root Navigator (Stack) ──────────────────────────────┐    │
│  │                                                          │    │
│  │  ┌─── Auth Stack ──────────────────┐                     │    │
│  │  │  Login ──▶ Register             │                     │    │
│  │  │    │                            │                     │    │
│  │  │    ▼                            │                     │    │
│  │  │  Forgot Password ──▶ Reset Code │                     │    │
│  │  └─────────────────────────────────┘                     │    │
│  │                                                          │    │
│  │  ┌─── Main (Tab Navigator) ────────────────────────┐     │    │
│  │  │                                                  │     │    │
│  │  │  Tab: Home    Tab: Search   Tab: Profile         │     │    │
│  │  │  ┌────────┐  ┌──────────┐  ┌──────────────┐     │     │    │
│  │  │  │ Feed   │  │ Search   │  │ Profile      │     │     │    │
│  │  │  │   │    │  │   │      │  │   │          │     │     │    │
│  │  │  │   ▼    │  │   ▼      │  │   ▼          │     │     │    │
│  │  │  │ Detail │  │ Results  │  │ Edit Profile │     │     │    │
│  │  │  │   │    │  │   │      │  │   │          │     │     │    │
│  │  │  │   ▼    │  │   ▼      │  │   ▼          │     │     │    │
│  │  │  │ Action │  │ Detail   │  │ Settings     │     │     │    │
│  │  │  └────────┘  └──────────┘  └──────────────┘     │     │    │
│  │  └──────────────────────────────────────────────────┘     │    │
│  │                                                          │    │
│  │  ┌─── Modal Stack (presented over Main) ─────────┐       │    │
│  │  │  Create Post ──▶ Preview ──▶ Confirm           │       │    │
│  │  │  Payment ──▶ Card Input ──▶ Success            │       │    │
│  │  └────────────────────────────────────────────────┘       │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Navigator Type Decision Tree

```
Need to decide which navigator pattern to use?

Is it a primary app section (Home, Search, Profile)?
  └─ YES → Tab Navigator
       └─ More than 5 tabs?
            └─ YES → Tab + "More" overflow or Drawer
            └─ NO  → Bottom Tab Bar

Is it a multi-step linear flow (Checkout, Onboarding)?
  └─ YES → Stack Navigator
       └─ Can the user jump to any step?
            └─ YES → Stack with step indicator (not tabs)
            └─ NO  → Linear stack, disable swipe-back

Is it a supplementary panel (Settings, Filters)?
  └─ YES → Modal presentation or Bottom Sheet
       └─ Does it need its own back stack?
            └─ YES → Modal Stack (stack inside a modal)
            └─ NO  → Single modal screen

Is it a side menu with section links?
  └─ YES → Drawer Navigator
       └─ Is the drawer always visible on tablet?
            └─ YES → Responsive: drawer on tablet, bottom tabs on phone
            └─ NO  → Standard drawer with hamburger toggle
```

### Transition Type Reference

| Pattern | iOS Convention | Android Convention | When to Use |
|---------|---------------|-------------------|-------------|
| Push | Slide from right | Slide from right | Drilling into detail (list -> item) |
| Modal Present | Slide from bottom | Slide from bottom | Interrupting flow (create, edit, pay) |
| Full Screen Modal | Cover entire screen | Cover entire screen | Media viewer, onboarding |
| Replace | No animation | No animation | Auth -> Main switch, tab content swap |
| Fade | Cross-dissolve | Fade through | Tab switches, same-level transitions |
| Shared Element | Hero animation | Container transform | Image gallery, card expansion |
| Bottom Sheet | Sheet detents | Bottom sheet | Filters, actions, quick forms |

---

## Phase 2: Route Configuration

Translate the navigation graph into typed, maintainable route definitions.

### React Navigation / Expo Router

```typescript
// --- Route param types (single source of truth) ---
type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  CreatePost: { draftId?: string };
  Payment: { orderId: string; amount: number };
};

type AuthStackParamList = {
  Login: { returnTo?: string };
  Register: undefined;
  ForgotPassword: undefined;
  ResetCode: { email: string };
};

type MainTabParamList = {
  HomeTab: undefined;
  SearchTab: undefined;
  ProfileTab: undefined;
};

type HomeStackParamList = {
  Feed: undefined;
  Detail: { itemId: string };
  Action: { itemId: string; actionType: 'share' | 'report' };
};

// --- Navigator structure ---
// Root (Stack)
//   ├── Auth (Stack) ← shown when !isAuthenticated
//   │     ├── Login
//   │     ├── Register
//   │     ├── ForgotPassword
//   │     └── ResetCode
//   ├── Main (BottomTab) ← shown when isAuthenticated
//   │     ├── HomeTab (Stack)
//   │     │     ├── Feed
//   │     │     ├── Detail
//   │     │     └── Action
//   │     ├── SearchTab (Stack)
//   │     └── ProfileTab (Stack)
//   └── Modal Group
//         ├── CreatePost
//         └── Payment
```

### GoRouter (Flutter)

```dart
// --- Route definitions ---
final router = GoRouter(
  initialLocation: '/',
  redirect: (context, state) {
    final isAuth = ref.read(authProvider).isAuthenticated;
    final isAuthRoute = state.matchedLocation.startsWith('/auth');

    if (!isAuth && !isAuthRoute) return '/auth/login';
    if (isAuth && isAuthRoute) return '/';
    return null;
  },
  routes: [
    ShellRoute(
      builder: (context, state, child) => MainShell(child: child),
      routes: [
        GoRoute(
          path: '/',
          builder: (_, __) => const FeedScreen(),
          routes: [
            GoRoute(
              path: 'detail/:itemId',
              builder: (_, state) => DetailScreen(
                itemId: state.pathParameters['itemId']!,
              ),
            ),
          ],
        ),
        GoRoute(path: '/search', builder: (_, __) => const SearchScreen()),
        GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen()),
      ],
    ),
    GoRoute(path: '/auth/login', builder: (_, __) => const LoginScreen()),
    GoRoute(path: '/auth/register', builder: (_, __) => const RegisterScreen()),
  ],
);
```

### SwiftUI NavigationStack

```swift
// --- Route enum (type-safe) ---
enum AppRoute: Hashable {
    case feed
    case detail(itemId: String)
    case action(itemId: String, actionType: ActionType)
    case profile(userId: String)
    case settings
}

enum ActionType: String, Hashable {
    case share, report
}

// --- Navigation path ---
@Observable class Router {
    var path = NavigationPath()
    var presentedSheet: SheetDestination?

    func push(_ route: AppRoute) { path.append(route) }
    func pop() { path.removeLast() }
    func popToRoot() { path.removeLast(path.count) }
    func present(_ sheet: SheetDestination) { presentedSheet = sheet }
}

// --- Root view ---
struct ContentView: View {
    @State private var router = Router()

    var body: some View {
        NavigationStack(path: $router.path) {
            FeedView()
                .navigationDestination(for: AppRoute.self) { route in
                    switch route {
                    case .feed: FeedView()
                    case .detail(let id): DetailView(itemId: id)
                    case .action(let id, let type): ActionView(itemId: id, type: type)
                    case .profile(let id): ProfileView(userId: id)
                    case .settings: SettingsView()
                    }
                }
        }
        .environment(router)
    }
}
```

### Platform Route Config Comparison

| Aspect | React Navigation 7 | GoRouter (Flutter) | NavigationStack (SwiftUI) |
|--------|--------------------|--------------------|--------------------------|
| Route definition | Navigator components + Screen | GoRoute tree | .navigationDestination |
| Type safety | ParamList generics | Path params (string) | Hashable enum |
| Deep link mapping | linking config object | Path-based (built-in) | URL handling in AppDelegate |
| Nested navigators | Navigator inside Screen | ShellRoute | NavigationSplitView |
| Modal presentation | Group screenOptions | Custom page builder | .sheet / .fullScreenCover |
| Tab persistence | unmountOnBlur: false | StatefulShellRoute | TabView default |
| Back handling | Custom back handler | Router.of(context).pop() | @Environment dismiss |
| Param validation | Runtime (unless Zod) | Runtime | Compile-time (enum) |

---

## Phase 3: Deep Linking Setup

Deep links connect the outside world to specific screens inside your app.

### Deep Link Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEEP LINK FLOW                               │
│                                                                 │
│  External Source                                                │
│  (Email, SMS, QR, Web)                                          │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────────┐   │
│  │ OS Intercept │────▶│ App Launch/  │────▶│ Link Parser    │   │
│  │ (Universal   │     │ Resume       │     │ (URL → Route)  │   │
│  │  Link / App  │     └──────────────┘     └───────┬────────┘   │
│  │  Link)       │                                  │            │
│  └──────────────┘                                  ▼            │
│                                          ┌─────────────────┐    │
│                                          │ Auth Check       │    │
│                                          │ Is user logged   │    │
│                                          │ in?              │    │
│                                          └────────┬────────┘    │
│                                    ┌──────────────┼───────┐     │
│                                    ▼              ▼       │     │
│                              ┌──────────┐  ┌──────────┐   │     │
│                              │ YES:     │  │ NO:      │   │     │
│                              │ Navigate │  │ Login →  │   │     │
│                              │ to route │  │ redirect │   │     │
│                              └──────────┘  └──────────┘   │     │
│                                                           │     │
│                              ┌─────────────────────────┐  │     │
│                              │ Build Correct Back Stack │◀─┘     │
│                              │ /orders → /orders/123   │        │
│                              └─────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### Deep Link Configuration Checklist

- [ ] Define URL scheme (custom scheme + universal/app links)
- [ ] Map every deep-linkable screen to a URL pattern
- [ ] Configure iOS: Associated Domains + apple-app-site-association file
- [ ] Configure Android: intent-filter + assetlinks.json
- [ ] Handle cold start — app killed, link opens app fresh
- [ ] Handle warm start — app backgrounded, link brings to foreground
- [ ] Handle foreground — app is open, link received via listener
- [ ] Build synthetic back stack for deep-linked screens
- [ ] Handle auth requirement — save link, redirect to login, replay after auth
- [ ] Handle invalid/expired links — show error screen, not a crash

### URL-to-Route Mapping Table

| URL Pattern | Route | Params | Back Stack |
|-------------|-------|--------|------------|
| `/` | Home > Feed | none | (root) |
| `/items/:id` | Home > Detail | itemId: string | Home > Feed |
| `/search?q=:query` | Search > Results | query: string | Search |
| `/profile/:userId` | Profile > View | userId: string | Profile |
| `/orders/:orderId` | Orders > Detail | orderId: string | Orders > List |
| `/settings/notifications` | Profile > Settings > Notifications | none | Profile > Settings |
| `/invite/:code` | (special) Accept Invite | code: string | Home > Feed |

### Three Deep Link States

```
┌──────────────────────────────────────────────────────────────┐
│  STATE 1: COLD START (app killed)                            │
│                                                              │
│  Link received → App launches → Splash → Auth check →       │
│  Parse link → Build back stack → Navigate to target          │
│                                                              │
│  Critical: Link must be captured in app launch params        │
│  (getInitialURL / initialRoute / onGenerateRoute)            │
├──────────────────────────────────────────────────────────────┤
│  STATE 2: BACKGROUND (app suspended)                         │
│                                                              │
│  Link received → App resumes → Parse link →                  │
│  Reset navigation state → Build back stack → Navigate        │
│                                                              │
│  Critical: Must handle via event listener, not launch params │
│  (onStateChange / Linking.addEventListener / onOpenURL)      │
├──────────────────────────────────────────────────────────────┤
│  STATE 3: FOREGROUND (app active)                            │
│                                                              │
│  Link received → Parse link → Navigate (push or replace)     │
│                                                              │
│  Critical: Decide whether to push on top of current stack    │
│  or reset and rebuild. Usually reset for cross-tab links.    │
└──────────────────────────────────────────────────────────────┘
```

---

## Phase 4: Auth-Gated Navigation

Authentication determines which navigation tree the user sees. The navigator owns this decision entirely.

### Auth Navigation Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTH NAVIGATION GATE                          │
│                                                                 │
│  ┌──────────────────┐                                           │
│  │ App Launch        │                                           │
│  │ Check auth token  │                                           │
│  └────────┬─────────┘                                           │
│           │                                                     │
│     ┌─────▼─────┐                                               │
│     │ Has valid  │                                               │
│     │ token?     │                                               │
│     └─────┬─────┘                                               │
│      YES  │   NO                                                │
│     ┌─────▼─────┐  ┌─────────────┐                              │
│     │ Token     │  │ Show Auth   │                              │
│     │ expired?  │  │ Stack       │◀──── returnTo saved          │
│     └─────┬─────┘  └──────┬──────┘                              │
│      YES  │   NO          │                                     │
│     ┌─────▼─────┐  ┌─────▼──────┐  ┌────────────────────┐      │
│     │ Refresh   │  │ Show Main  │  │ Login success →     │      │
│     │ token     │  │ Navigator  │  │ Navigate to         │      │
│     └─────┬─────┘  └────────────┘  │ returnTo or Home    │      │
│      OK   │  FAIL                  └────────────────────┘      │
│     ┌─────▼─────┐  ┌─────────┐                                 │
│     │ Show Main │  │ Clear   │                                 │
│     │ Navigator │  │ tokens, │                                 │
│     └───────────┘  │ show    │                                 │
│                    │ Auth    │                                 │
│                    └─────────┘                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Auth Gate Implementation Pattern

```
// Conceptual — framework-agnostic pattern

ROOT NAVIGATOR decides:
  IF (authState === 'loading')    → show SplashScreen
  IF (authState === 'logged_out') → show AuthStack
  IF (authState === 'logged_in')  → show MainNavigator

NEVER do this inside a screen:
  // WRONG — auth logic inside a screen component
  function ProfileScreen() {
    if (!user) return <Navigate to="Login" />  // BAD
    return <Profile />
  }

ALWAYS do this at the navigator level:
  // RIGHT — navigator conditionally renders the correct tree
  function RootNavigator() {
    if (isLoading) return <SplashScreen />
    return isAuthenticated ? <MainNavigator /> : <AuthStack />
  }
```

### Session Expiry Mid-Flow

```
┌──────────────────────────────────────────────────────────────┐
│  SCENARIO: User is filling a form, token expires             │
│                                                              │
│  1. API call returns 401                                     │
│  2. Auth interceptor attempts token refresh                  │
│  3a. Refresh succeeds → retry original request silently      │
│  3b. Refresh fails →                                         │
│      - Save current route + form state to returnTo           │
│      - Navigate to Login screen                              │
│      - After login, restore route + form state               │
│                                                              │
│  KEY: The user should NEVER lose form data due to session    │
│  expiry. Save state before redirecting.                      │
└──────────────────────────────────────────────────────────────┘
```

### Role-Based Navigation

| User Role | Visible Tabs | Hidden Screens | Notes |
|-----------|-------------|----------------|-------|
| Guest | Home, Search | Profile, Orders | Read-only browsing |
| User | Home, Search, Profile, Orders | Admin | Full consumer experience |
| Admin | Home, Search, Profile, Orders, Admin | (none) | Admin tab added |
| Instructor | Home, Courses, Students, Profile | Orders, Admin | Different tab set entirely |

```
// Role-based tab rendering
function getTabsForRole(role: UserRole): TabConfig[] {
  const baseTabs = [
    { name: 'Home', icon: HomeIcon, screen: 'HomeStack' },
    { name: 'Search', icon: SearchIcon, screen: 'SearchStack' },
  ];

  switch (role) {
    case 'admin':
      return [...baseTabs, profileTab, ordersTab, adminTab];
    case 'instructor':
      return [baseTabs[0], coursesTab, studentsTab, profileTab];
    case 'user':
      return [...baseTabs, profileTab, ordersTab];
    case 'guest':
      return baseTabs;
  }
}
```

---

## Phase 5: Tab + Stack Composition

The most common mobile navigation pattern is tabs at the root, with stacks inside each tab. Getting this composition right is critical.

### Composition Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                TAB + STACK COMPOSITION                          │
│                                                                 │
│  ┌─── BottomTabNavigator ──────────────────────────────────┐    │
│  │                                                          │    │
│  │  Tab 1: Home          Tab 2: Search     Tab 3: Profile   │    │
│  │  ┌─────────────┐     ┌──────────────┐  ┌─────────────┐  │    │
│  │  │ HomeStack   │     │ SearchStack  │  │ ProfileStack│  │    │
│  │  │             │     │              │  │             │  │    │
│  │  │  Feed       │     │  SearchHome  │  │  Profile    │  │    │
│  │  │    ↓ push   │     │    ↓ push    │  │    ↓ push   │  │    │
│  │  │  Detail     │     │  Results     │  │  EditProf   │  │    │
│  │  │    ↓ push   │     │    ↓ push    │  │    ↓ push   │  │    │
│  │  │  Comments   │     │  Detail*     │  │  Settings   │  │    │
│  │  └─────────────┘     └──────────────┘  └─────────────┘  │    │
│  │                                                          │    │
│  │  * Detail screen reused across tabs with different stacks│    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─── Modal Layer (presented over tabs) ─────────────────┐      │
│  │  CreateFlow (Stack): Step1 → Step2 → Step3 → Done     │      │
│  │  PaymentFlow (Stack): Select → Card → Confirm → Rcpt  │      │
│  └───────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### Tab Persistence Decision

| Behavior | Description | When to Use |
|----------|-------------|-------------|
| Persist stack | Tab retains its navigation stack when switching away | Default for most apps. User expects to return where they left off |
| Reset to root | Tab resets to its root screen when switching away | Content-heavy apps where stale detail screens are confusing |
| Reset on double-tap | Stack persists normally, but double-tapping the tab resets to root | Best of both worlds. Instagram, Twitter pattern |
| Selective persist | Some tabs persist (e.g., Home), others reset (e.g., Search) | Complex apps where some tabs are entry points and others are destinations |

### Shared Screens Across Tabs

When the same screen (e.g., ItemDetail) appears in multiple tabs:

```
APPROACH 1: Duplicate screen in each stack (recommended)
  HomeStack: Feed → ItemDetail (instance A)
  SearchStack: Results → ItemDetail (instance B)
  - Separate navigation state per tab
  - Back button always correct
  - Slightly more memory, but predictable

APPROACH 2: Shared screen with tab tracking
  Single ItemDetail screen, tracks which tab opened it
  - Less duplication
  - Back behavior requires manual stack management
  - Risk: switching tabs while Detail is open — where does it go?

RECOMMENDATION: Use Approach 1. The memory cost is negligible.
The predictability gain is significant.
```

---

## Phase 6: Navigation State Persistence

When the app is killed and restarted, should navigation state be restored?

### Persistence Decision Matrix

| App Type | Restore Nav State? | Rationale |
|----------|-------------------|-----------|
| Banking / Finance | NO | Security — always start at authenticated entry point |
| E-commerce | Partial — restore cart, not browsing | Cart is valuable; browsing history is ephemeral |
| Social media | YES — restore scroll position + tab | Users expect to continue where they left off |
| Productivity / Notes | YES — restore document + position | Losing position in a long document is frustrating |
| Games | YES — restore game state via save | Game progress is the core value |
| Onboarding / Setup | NO — restart the wizard | Partial onboarding state is error-prone |

### State Persistence Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│               STATE PERSISTENCE FLOW                            │
│                                                                 │
│  APP BACKGROUNDED / KILLED                                      │
│  ┌──────────────────────┐                                       │
│  │ Serialize nav state   │                                       │
│  │ (routes + params)     │──▶ AsyncStorage / MMKV / UserDefaults│
│  └──────────────────────┘                                       │
│                                                                 │
│  APP LAUNCHED                                                   │
│  ┌──────────────────────┐     ┌──────────────────────┐          │
│  │ Read persisted state  │────▶│ Validate state       │          │
│  └──────────────────────┘     │ - Auth still valid?  │          │
│                               │ - Routes still exist?│          │
│                               │ - Params still valid?│          │
│                               └──────────┬───────────┘          │
│                                    VALID  │  INVALID            │
│                                ┌──────────▼──┐  ┌────────────┐  │
│                                │ Restore     │  │ Discard,   │  │
│                                │ nav state   │  │ start fresh│  │
│                                └─────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### What to Persist and What to Skip

| Persist | Skip |
|---------|------|
| Current tab index | Form input (use form-specific drafts) |
| Stack routes (screen names + params) | Scroll position (restore separately) |
| Modal open state (if resumable) | Temporary UI state (tooltips, popovers) |
| Selected filters / search query | API response data (refetch on mount) |
| Deep link returnTo state | Expired session tokens |

### Validation Before Restore

```
function validatePersistedState(state: NavigationState): boolean {
  // 1. Check schema version — did the nav tree change since last persist?
  if (state.schemaVersion !== CURRENT_NAV_SCHEMA_VERSION) return false;

  // 2. Check auth — is the user still logged in?
  if (requiresAuth(state) && !isAuthenticated()) return false;

  // 3. Check routes — do all persisted routes still exist?
  for (const route of extractRoutes(state)) {
    if (!routeRegistry.has(route.name)) return false;
  }

  // 4. Check staleness — is the state too old?
  if (Date.now() - state.timestamp > MAX_STATE_AGE_MS) return false;

  return true;
}
```

---

## Phase 7: Testing Navigation

Navigation is the highest-risk surface area in a mobile app. Broken navigation means a broken app.

### Navigation Test Matrix

| Test Category | What to Verify | Test Method |
|--------------|----------------|-------------|
| Forward navigation | Tapping a list item pushes the detail screen with correct params | Integration test |
| Back navigation | Pressing back from detail returns to the list with scroll position preserved | Integration test |
| Tab switching | Switching tabs preserves per-tab stack state | Integration test |
| Deep link cold start | Opening a deep link from killed state shows the correct screen with correct back stack | E2E test (Detox/Maestro) |
| Deep link warm start | Opening a deep link with app backgrounded navigates correctly | E2E test |
| Auth gate | Unauthenticated user accessing protected route sees login, then redirects after auth | Integration test |
| Session expiry | Expired token during navigation redirects to login with returnTo | Integration test |
| Modal dismiss | Dismissing a modal returns to the correct underlying screen | Integration test |
| System back (Android) | Android back button behavior matches expectations at every screen | Manual + E2E |
| Swipe back (iOS) | iOS swipe-back gesture works on all stack screens, disabled on modals | Manual test |
| Role switch | Changing user role updates visible tabs without full app restart | Integration test |
| Offline navigation | Navigation works when offline (no network calls block transitions) | Integration test |

### Deep Link Test Scenarios

```
┌──────────────────────────────────────────────────────────────┐
│  DEEP LINK TEST PLAN                                         │
│                                                              │
│  For each deep-linkable screen, test ALL of these:           │
│                                                              │
│  1. Cold start (app killed)                                  │
│     - Open link → app launches → correct screen shown        │
│     - Press back → lands on correct parent screen            │
│                                                              │
│  2. Background (app suspended)                               │
│     - Open link → app resumes → navigates to screen          │
│     - Previous nav state is replaced, not stacked on top     │
│                                                              │
│  3. Foreground (app active, same tab)                        │
│     - Open link → navigates within current tab               │
│                                                              │
│  4. Foreground (app active, different tab)                   │
│     - Open link → switches tab → navigates to screen         │
│                                                              │
│  5. Auth required (user logged out)                          │
│     - Open link → shows login → after login → correct screen │
│                                                              │
│  6. Invalid link (bad params or deleted resource)            │
│     - Open link → shows error screen, not crash              │
│                                                              │
│  7. Expired link (time-sensitive content)                    │
│     - Open link → shows "expired" message                    │
└──────────────────────────────────────────────────────────────┘
```

### Back Stack Verification

For every screen, document the expected back behavior:

| Current Screen | Back Action | Expected Destination | Stack After Back |
|---------------|-------------|---------------------|-----------------|
| Feed | (disabled or exit) | Exit app / no-op | [] |
| Detail (from Feed) | Pop | Feed | [Feed] |
| Detail (from deep link) | Pop | Feed (synthetic) | [Feed] |
| Detail (from Search) | Pop | Search Results | [Search, Results] |
| Create Post (modal) | Dismiss | Previous screen (any) | (unchanged) |
| Settings > Notifications | Pop | Settings | [Profile, Settings] |
| Login | (disabled) | No-op | [Login] |
| Onboarding Step 3 | Pop | Step 2 | [Step1, Step2] |

---

## Navigation Anti-Patterns

Avoid these patterns that cause bugs, crashes, and confused users.

| Anti-Pattern | Problem | Correct Pattern |
|-------------|---------|-----------------|
| Navigating inside useEffect/initState without guards | Race conditions, double navigation | Use navigation-ready callbacks, guard with isMounted |
| Passing complex objects as route params | Serialization failures, stale data | Pass IDs, fetch data in the destination screen |
| Using global state to communicate between screens | Tight coupling, stale state on back | Pass params or use route-scoped state |
| Checking auth inside every screen | Duplicated logic, inconsistent gates | Handle auth at the navigator level |
| Hardcoding route strings | Typos cause silent failures | Use typed route enums or constants |
| Resetting entire nav state on logout | Loss of deep link returnTo | Replace root route, preserve returnTo in secure storage |
| Ignoring Android back button | App feels broken on Android | Handle hardware back at every navigator level |
| Pushing the same screen twice on fast double-tap | Duplicate screens in stack | Debounce navigation actions or use `getId` |
| Using replace when you need push | Back button skips a screen | Map each transition to push, replace, or reset explicitly |

---

## Tips for Best Results

1. **Draw the full navigation graph on paper or whiteboard before opening your IDE.** A 30-minute graph session saves days of refactoring. Every navigation bug you will ever encounter is a graph bug you missed.

2. **Type every route param at the boundary.** When a screen receives params, validate them immediately. Treat navigation params like API inputs — never trust them blindly.

3. **Test deep links from all three states on real devices.** Simulators handle deep links differently than real hardware. Cold start behavior in particular varies between iOS and Android.

4. **Use a single file for your entire route registry.** When route definitions are scattered across 20 files, nobody knows the full graph. One file, one source of truth, one place to audit.

5. **Document back behavior in a table, not in your head.** The back stack is invisible state. If you cannot write down where every back press lands, your users will discover the bugs for you.

6. **Handle the "double tap" problem from day one.** Fast double-taps on navigation buttons push duplicate screens. Debounce navigation calls or use navigator-level deduplication. This is the single most common navigation bug in production apps.

7. **Separate navigation events from navigation actions.** "User tapped a list item" is an event. "Push DetailScreen with itemId" is an action. Keep the mapping in one place. When analytics, logging, or A/B tests need to intercept navigation, they hook into the event layer, not the action layer.

8. **Version your navigation schema.** When you add, remove, or rename screens, bump a schema version. Persisted navigation state from an old schema should be discarded gracefully, not crash the app on launch.

<!-- MIT License — Copyright (c) 2025 Heaptrace Technology Private Limited -->
