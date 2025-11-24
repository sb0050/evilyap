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

import LandingPageBis from './pages/LandingPageBis';
import CheckoutPage from './pages/CheckoutPage';
import AccountPage from './pages/AccountPage';
import OrdersPage from './pages/OrdersPage';
import OnboardingPage from './pages/OnboardingPage';
import AuthRedirect from './components/AuthRedirect';
import PaymentReturnPage from './pages/PaymentReturnPage';
import { frFR } from '@clerk/localizations';
import DashboardPage from './pages/DashboardPage';

import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsAndConditions from './pages/TermsAndConditions';
import FormPage from './pages/FormPage';
import AdminPage from './pages/AdminPage';

function App() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error('Missing Clerk Publishable Key');
  }

  return (
    <ClerkProvider publishableKey={publishableKey} localization={frFR}>
      <Router>
        <div className='min-h-screen bg-gray-50'>
          <Routes>
            <Route path='/' element={<LandingPageBis />} />
            {/* Pages publiques: PDF */}
            <Route path='/privacy_policy' element={<PrivacyPolicy />} />
            <Route
              path='/terms_and_conditions'
              element={<TermsAndConditions />}
            />
            <Route
              path='/form'
              element={
                <>
                  <FormPage />
                </>
              }
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
                    <LandingPageBis />
                  </SignedOut>
                </>
              }
            />
            <Route
              path='/*'
              element={
                <>
                  <LandingPageBis />
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
