import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
} from '@clerk/clerk-react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import HomePage from './pages/HomePage';
import CheckoutPage from './pages/CheckoutPage';
import CompletePage from './pages/CompletePage';
import AccountPage from './pages/AccountPage';
import OrdersPage from './pages/OrdersPage';

function App() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error('Missing Clerk Publishable Key');
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <Router>
        <div className='min-h-screen bg-gray-50'>
          <Header />
          <Routes>
            <Route path='/' element={<HomePage />} />
            <Route
              path='/checkout'
              element={
                <SignedIn>
                  <CheckoutPage />
                </SignedIn>
              }
            />
            <Route
              path='/complete'
              element={
                <SignedIn>
                  <CompletePage />
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
          </Routes>
          <SignedOut>
            <RedirectToSignIn />
          </SignedOut>
        </div>
      </Router>
    </ClerkProvider>
  );
}

export default App;
