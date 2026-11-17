import { MantineProvider, Text, Title } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { getToken } from '../api/auth';
import { ApiError } from '../api/http';
import { SpacesPage } from '../features/spaces';
import { WorkspacePage } from '../pages/WorkspacePage';

// The server pushes changes over WS (`fs.changed`, `git.changed`, ...) and a reconnect re-sends the
// history, so cached data stays fresh for a while and a focus change does not refetch. Queries
// without a push (spaces list, folder browser) set `staleTime: 0` themselves.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError) && n < 3,
    },
  },
});

export function NotFound() {
  return (
    <main style={{ padding: 16 }}>
      <Title order={2}>Not found</Title>
      <Text>
        <Link to="/">Back to spaces</Link>
      </Text>
    </main>
  );
}

function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      {getToken() ? (
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<SpacesPage />} />
              <Route path="/spaces/:id" element={<WorkspacePage />} />
              <Route path="*" element={<NotFound />} />
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
