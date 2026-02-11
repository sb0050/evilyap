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
  useLocation,
} from 'react-router-dom';
import { dark, neobrutalism } from '@clerk/themes';

import LandingPage from './pages/LandingPage';
import CheckoutPage from './pages/CheckoutPage';
import OrdersPage from './pages/OrdersPage';
import OnboardingPage from './pages/OnboardingPage';
import PaymentReturnPage from './pages/PaymentReturnPage';
import { frFR } from '@clerk/localizations';

import PrivacyPolicy from './pages/public/PrivacyPolicy';
import TermsAndConditions from './pages/public/TermsAndConditions';
import AdminPage from './pages/admin/AdminPage';
import { useEffect } from 'react';
import DashboardPage from './pages/dashboard/DashboardPage';
import StorePage from './pages/StorePage';

function App() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const LocationTracker: React.FC = () => {
    const location = useLocation();
    useEffect(() => {
      try {
        const fbq = (window as any).fbq;
        if (typeof fbq === 'function') {
          fbq('track', 'PageView');
        }
      } catch {}
      try {
        const w = window as any;
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({
          event: 'page_view',
          page_path: `${location.pathname}${location.search}${location.hash}`,
          page_location: window.location.href,
          page_title: document.title,
        });
      } catch {}
    }, [location.pathname, location.search, location.hash]);
    return null;
  };

  if (!publishableKey) {
    throw new Error('Missing Clerk Publishable Key');
  }

  return (
    <ClerkProvider publishableKey={publishableKey} localization={frFR}>
      <Router>
        <div className='min-h-screen bg-gray-50'>
          <LocationTracker />
          <Routes>
            <Route path='/' element={<LandingPage />} />
            {/* Pages publiques: PDF */}
            <Route path='/privacy_policy' element={<PrivacyPolicy />} />
            <Route
              path='/terms_and_conditions'
              element={<TermsAndConditions />}
            />
            <Route
              path='/checkout/:storeName'
              element={
                <>
                  <SignedIn>
                    <CheckoutPage />
                  </SignedIn>
                  <SignedOut>
                    <RedirectToSignUp />
                  </SignedOut>
                </>
              }
            />
            {/* Alias court vers Checkout */}
            <Route
              path='/c/:storeName'
              element={
                <>
                  <SignedIn>
                    <CheckoutPage />
                  </SignedIn>
                  <SignedOut>
                    <RedirectToSignUp />
                  </SignedOut>
                </>
              }
            />
            <Route
              path='/store/:storeName'
              element={<StorePage />}
            />
            <Route
              path='/onboarding'
              element={
                <>
                  <SignedIn>
                    <OnboardingPage />
                  </SignedIn>
                  <SignedOut>
                    <RedirectToSignUp />
                  </SignedOut>
                </>
              }
            />

            <Route
              path='/orders'
              element={
                <>
                  <SignedIn>
                    <OrdersPage />
                  </SignedIn>
                  <SignedOut>
                    <RedirectToSignUp />
                  </SignedOut>
                </>
              }
            />
            <Route
              path='/dashboard'
              element={
                <>
                  <SignedIn>
                    <DashboardPage />
                  </SignedIn>
                  <SignedOut>
                    <RedirectToSignUp />
                  </SignedOut>
                </>
              }
            />
            <Route
              path='/admin'
              element={
                <>
                  <SignedIn>
                    <AdminPage />
                  </SignedIn>
                  <SignedOut>
                    <RedirectToSignUp />
                  </SignedOut>
                </>
              }
            />
            <Route
              path='/payment/return'
              element={
                <>
                  <SignedIn>
                    <PaymentReturnPage />
                  </SignedIn>
                  <SignedOut>
                    <LandingPage />
                  </SignedOut>
                </>
              }
            />
            <Route
              path='/*'
              element={
                <>
                  <LandingPage />
                </>
              }
            />
          </Routes>
        </div>
      </Router>
    </ClerkProvider>
  );
}

export default App;
