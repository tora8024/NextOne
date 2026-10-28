import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout } from './components/Layout';
import { STORAGE_KEY } from './lib/db';
import { StoreProvider } from './lib/store';
import { CustomerDetailPage } from './pages/CustomerDetail';
import { CustomerListPage } from './pages/CustomerList';
import { DashboardPage } from './pages/Dashboard';
import { DeviceDetailPage } from './pages/DeviceDetail';
import { DeviceListPage } from './pages/DeviceList';
import { LookupPage } from './pages/Lookup';
import { NotFoundPage } from './pages/NotFound';
import { OrderDetailPage } from './pages/OrderDetail';
import { OrderFormPage } from './pages/OrderForm';
import { OrderListPage } from './pages/OrderList';

type BoundaryProps = { children: ReactNode };
type BoundaryState = { message: string | null };

class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return (
        <div className="fatal">
          <h1>畫面無法顯示</h1>
          <p>{this.state.message}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              try {
                localStorage.removeItem(STORAGE_KEY);
              } catch {
                // ignore
              }
              window.location.reload();
            }}
          >
            清除本機資料並重試
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function NewOrderRoute() {
  const location = useLocation();
  return <OrderFormPage key={location.search} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <StoreProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/lookup" element={<LookupPage />} />
            <Route element={<AdminLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="orders" element={<OrderListPage />} />
              <Route path="orders/new" element={<NewOrderRoute />} />
              <Route path="orders/:orderId" element={<OrderDetailPage />} />
              <Route path="customers" element={<CustomerListPage />} />
              <Route path="customers/:customerId" element={<CustomerDetailPage />} />
              <Route path="devices" element={<DeviceListPage />} />
              <Route path="devices/:deviceId" element={<DeviceDetailPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </StoreProvider>
    </ErrorBoundary>
  );
}
