import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  fbSignOut, 
  onAuthStateChanged, 
  User 
} from '../lib/firebase';
import { abortAllRequests } from '../lib/api';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  token: string | null;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  signupWithEmail: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode; initialUser?: User | null }> = ({ children, initialUser }) => {
  const [user, setUser] = useState<User | null>(initialUser !== undefined ? initialUser : null);
  const [loading, setLoading] = useState(initialUser === undefined);
  const [token, setToken] = useState<string | null>(initialUser ? 'mock-id-token' : null);

  useEffect(() => {
    if (initialUser !== undefined) {
      setUser(initialUser);
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const idToken = await currentUser.getIdToken();
          setToken(idToken);
        } catch (e) {
          console.error('Error fetching Firebase ID token:', e);
          setToken(null);
        }
      } else {
        setToken(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [initialUser]);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Google Sign-In failed:', err);
      throw err;
    }
  };

  const loginWithEmail = async (email: string, pass: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
      console.error('Email Sign-In failed:', err);
      throw err;
    }
  };

  const signupWithEmail = async (email: string, pass: string) => {
    try {
      await createUserWithEmailAndPassword(auth, email, pass);
    } catch (err) {
      console.error('Sign-Up failed:', err);
      throw err;
    }
  };

  const logout = async () => {
    try {
      // 1. Immediately abort all in-flight API requests to prevent stale responses from overwriting state
      abortAllRequests();

      // 2. Clear sensitive in-memory auth state
      setUser(null);
      setToken(null);

      // 3. Dispatch global logout event for component state clearing
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('jobfinder:logout'));
      }

      // 4. Execute Firebase sign-out
      await fbSignOut(auth);
    } catch (err) {
      console.error('Sign-Out failed:', err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        token,
        loginWithGoogle,
        loginWithEmail,
        signupWithEmail,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const mockTestUser: User = {
  uid: 'user_default',
  email: 'affan@example.com',
  displayName: 'Mohammed Affan Razvi',
  getIdToken: async () => 'mock-id-token',
} as unknown as User;

const defaultAuthContext: AuthContextType = {
  user: null,
  loading: false,
  token: null,
  loginWithGoogle: async () => {},
  loginWithEmail: async () => {},
  signupWithEmail: async () => {},
  logout: async () => {},
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    return defaultAuthContext;
  }
  return context;
};
