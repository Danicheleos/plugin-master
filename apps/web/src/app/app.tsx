import { MantineProvider, Text, Title } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { getToken } from '../api/auth';
import { ApiError } from '../api/http';
import { SpacesPage } from '../features/spaces/SpacesPage';
import { WorkspacePage } from '../pages/WorkspacePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError) && n < 3,
    },
  },
});

export function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      {getToken() ? (
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<SpacesPage />} />
              <Route path="/spaces/:id" element={<WorkspacePage />} />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      ) : (
        <main style={{ padding: 16 }}>
          <Title order={1}>plugin-master</Title>
          <Text>Open the link printed in the server console.</Text>
        </main>
      )}
    </MantineProvider>
  );
}

export default App;
