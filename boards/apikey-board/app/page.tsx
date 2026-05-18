import { Suspense } from 'react';

import { APIKeyBoard } from '@/components/apikey-board';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <APIKeyBoard />
    </Suspense>
  );
}
