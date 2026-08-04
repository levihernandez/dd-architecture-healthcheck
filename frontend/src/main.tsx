import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrgScanProvider } from './context/OrgScanContext';
import { initDatadog } from './lib/datadog';
import App from './App';
import './index.css';

initDatadog();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <OrgScanProvider>
        <App />
      </OrgScanProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
