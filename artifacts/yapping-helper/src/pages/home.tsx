import { useEffect, useState } from 'react';
import { JobCreator } from '@/components/job-creator';
import { JobProgress } from '@/components/job-progress';
import { JobResults } from '@/components/job-results';
import { useGetJob } from '@workspace/api-client-react';
import { JobStatus, getGetJobQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Video } from 'lucide-react';

export default function Home() {
  const queryClient = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string | null>(() => (
    new URLSearchParams(window.location.search).get('job')
  ));

  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeJobId) {
      url.searchParams.set('job', activeJobId);
    } else {
      url.searchParams.delete('job');
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [activeJobId]);
  
  const { data: job } = useGetJob(activeJobId!, {
    query: {
      enabled: !!activeJobId,
      queryKey: getGetJobQueryKey(activeJobId!),
    }
  });

  const handleRestart = () => {
    setActiveJobId(null);
  };

  const handleDeleted = () => {
    if (activeJobId) {
      queryClient.removeQueries({ queryKey: getGetJobQueryKey(activeJobId) });
    }
    setActiveJobId(null);
  };

  const handleJobCreated = (jobId: string) => {
    setActiveJobId(jobId);
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col">
      <header className="border-b-2 border-border bg-card sticky top-0 z-10">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer"
            onClick={handleRestart}
          >
            <div className="w-8 h-8 bg-primary rounded flex items-center justify-center text-primary-foreground">
              <Video className="w-5 h-5" />
            </div>
            <span className="font-black text-xl tracking-tight uppercase">Yapping Helper</span>
          </div>
          
          <div className="font-mono text-sm font-bold text-muted-foreground hidden sm:block">
            {activeJobId ? 'SESSION ACTIVE' : 'READY'}
          </div>
        </div>
      </header>
      
      <main className="flex-1 container mx-auto px-4 sm:px-6 py-12 md:py-24 flex items-center justify-center">
        {!activeJobId ? (
           <JobCreator onJobCreated={handleJobCreated} />
        ) : job?.status === JobStatus.COMPLETE || (job?.status === JobStatus.FAILED && job.clips.length > 0) ? (
          <JobResults jobId={activeJobId} onDeleted={handleDeleted} />
        ) : (
          <JobProgress 
            jobId={activeJobId} 
            onComplete={() => undefined}
            onDeleted={handleDeleted}
          />
        )}
      </main>
    </div>
  );
}
