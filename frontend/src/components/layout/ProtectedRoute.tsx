import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireSuperAdmin?: boolean;
}

export default function ProtectedRoute({
  children,
  requireSuperAdmin = false,
}: ProtectedRouteProps): React.JSX.Element {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireSuperAdmin && !user?.isSuperAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
