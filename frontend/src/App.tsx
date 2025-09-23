import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  RedirectToSignUp,
} from '@clerk/clerk-react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { dark, neobrutalism } from '@clerk/themes';

import LandingPage from './pages/LandingPage';
import CheckoutPage from './pages/CheckoutPage';
import AccountPage from './pages/AccountPage';
import OrdersPage from './pages/OrdersPage';
import OnboardingPage from './pages/OnboardingPage';
import StorePage from './pages/StorePage';
import AuthRedirect from './components/AuthRedirect';
import PaymentReturnPage from './pages/PaymentReturnPage';

function App() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error('Missing Clerk Publishable Key');
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={{
        baseTheme: [dark, neobrutalism],
      }}
    >
      <Router>
        <div className='min-h-screen bg-gray-50'>
          <Routes>
            <Route path='/' element={<LandingPage />} />
            <Route
              path='/stores'
              element={
                <>
                  <SignedIn>
                    <AuthRedirect>
                      <CheckoutPage />
                    </AuthRedirect>
                  </SignedIn>
                  <SignedOut>
                    <RedirectToSignUp />
                  </SignedOut>
                </>
              }
            />
            <Route
              path='/store/:storeName'
              element={
                <SignedIn>
                  <StorePage />
                </SignedIn>
              }
            />
            <Route
              path='/checkout/:storeName'
              element={
                <SignedIn>
                  <CheckoutPage />
                </SignedIn>
              }
            />
            <Route
              path='/account'
              element={
                <SignedIn>
                  <AccountPage />
                </SignedIn>
              }
            />
            <Route
              path='/orders'
              element={
                <SignedIn>
                  <OrdersPage />
                </SignedIn>
              }
            />
            <Route
              path='/onboarding'
              element={
                <SignedIn>
                  <OnboardingPage />
                </SignedIn>
              }
            />
            <Route
              path='/payment/return'
              element={<PaymentReturnPage />}
            />
          </Routes>
        </div>
      </Router>
    </ClerkProvider>
  );
}

export default App;
