import React, { useState, useEffect, useRef } from 'react';
import type { ToolCallEntry } from '../hooks/useChat';

interface RowProps { entry: ToolCallEntry; }

export const ToolCallRow: React.FC<RowProps> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (entry.status === 'running') {
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - entry.startTime);
      }, 100);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setElapsed((entry.endTime ?? Date.now()) - entry.startTime);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [entry.status, entry.startTime, entry.endTime]);

  const statusIcon =
    entry.status === 'running' ? '◉' :
    entry.status === 'done'    ? '✓' : '✗';

  const rowClass = [
    'tool-call-row',
    entry.status === 'error' ? 'error' : '',
    entry.status === 'done'  ? 'done'  : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClass}>
      <div className="tool-call-row-header" onClick={() => setExpanded(e => !e)}>
        <span>{statusIcon}</span>
        <span className="tool-call-name">{entry.name}</span>
        {entry.params && <span className="tool-call-params">{entry.params}</span>}
        <span className="tool-call-elapsed">⏱ {(elapsed / 1000).toFixed(1)}s</span>
        <span className={`tool-call-chevron${expanded ? ' open' : ''}`}>▶</span>
      </div>
      {expanded && entry.resultSummary && (
        <div className="tool-call-body">{entry.resultSummary.slice(0, 300)}</div>
      )}
      <div className={`tool-call-progress${entry.status !== 'running' ? ' done' : ''}`} />
    </div>
  );
};

interface AreaProps { toolCalls: ToolCallEntry[]; }

export const ToolStatusArea: React.FC<AreaProps> = ({ toolCalls }) => {
  if (toolCalls.length === 0) return null;
  return (
    <div style={{ paddingBottom: '4px' }}>
      {toolCalls.map(tc => <ToolCallRow key={tc.id} entry={tc} />)}
    </div>
  );
};
