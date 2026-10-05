import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Save, Globe, Key, ShieldCheck, RefreshCw } from 'lucide-react';
import { getSettings, saveSettings } from '../services/storage';

export default function Options() {
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('http://localhost:8000');
  const [clipToken, setClipToken] = useState<string>('');
  const [saved, setSaved] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    getSettings().then((s) => {
      setApiBaseUrl(s.apiBaseUrl);
      setClipToken(s.clipToken);
    });
  }, []);

  const handleSave = async () => {
    await saveSettings({
      apiBaseUrl: apiBaseUrl.trim().replace(/\/+$/, ''),
      clipToken: clipToken.trim(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    const baseUrl = apiBaseUrl.trim().replace(/\/+$/, '');
    const healthUrl = `${baseUrl}/api/v1/health`;

    try {
      const res = await fetch(healthUrl, { method: 'GET' });
      if (res.ok) {
        setTestResult({
          success: true,
          message: `Connected successfully to JobFinder API at ${baseUrl}`,
        });
      } else {
        setTestResult({
          success: false,
          message: `Server returned HTTP ${res.status} from ${healthUrl}`,
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Connection failed: ${err.message || 'Make sure FastAPI backend is running.'}`,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-8 px-6 bg-[#0D0D0D] min-h-screen text-white">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
        <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center font-bold text-base shadow-sm">
          JF
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white">
            JobFinder Clipper Settings
          </h1>
          <p className="text-xs text-primary-secondary">
            Configure local pairing between this browser extension and your JobFinder instance.
          </p>
        </div>
      </div>

      {saved && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          Settings saved successfully!
        </div>
      )}

      {testResult && (
        <div
          className={`mb-4 p-3 rounded-lg text-xs flex items-start gap-2 border ${
            testResult.success
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
          }`}
        >
          {testResult.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
          )}
          <span>{testResult.message}</span>
        </div>
      )}

      <div className="space-y-5 bg-[#161616] p-5 rounded-xl border border-border">
        {/* API Base URL */}
        <div>
          <label className="block text-xs font-semibold text-white mb-1.5 flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-emerald-400" /> JobFinder API URL
          </label>
          <input
            type="text"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="http://localhost:8000"
            className="w-full px-3 py-2 text-xs bg-[#0D0D0D] border border-border rounded-lg text-white focus:outline-none focus:border-emerald-500 font-mono transition-colors"
          />
          <p className="text-[11px] text-primary-muted mt-1">
            Default: <code className="text-neutral-400">http://localhost:8000</code>. Points to your local or deployed JobFinder FastAPI server.
          </p>
        </div>

        {/* Clip Authentication Token */}
        <div>
          <label className="block text-xs font-semibold text-white mb-1.5 flex items-center gap-1.5">
            <Key className="w-4 h-4 text-emerald-400" /> Clip Access Token (Optional)
          </label>
          <input
            type="password"
            value={clipToken}
            onChange={(e) => setClipToken(e.target.value)}
            placeholder="clp_live_... or User ID"
            className="w-full px-3 py-2 text-xs bg-[#0D0D0D] border border-border rounded-lg text-white focus:outline-none focus:border-emerald-500 font-mono transition-colors"
          />
          <p className="text-[11px] text-primary-muted mt-1">
            Leave blank if running locally with default mock authentication. When configured, requests transmit via scoped <code className="text-neutral-400">Bearer</code> token.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <button
            onClick={handleTestConnection}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-300 hover:text-white bg-[#222222] hover:bg-[#2c2c2c] rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
            {testing ? 'Testing...' : 'Test Connection'}
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 rounded-lg shadow-sm transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            Save Settings
          </button>
        </div>
      </div>

      <div className="mt-6 p-4 rounded-lg bg-[#141414] border border-border/70 flex items-start gap-3 text-xs text-primary-secondary">
        <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold text-white mb-0.5">Privacy & Security First</p>
          <p className="leading-relaxed text-[11px]">
            The JobFinder extension only executes DOM extraction on active job posting tabs when you click the extension. No background browsing telemetry is collected or transmitted.
          </p>
        </div>
      </div>
    </div>
  );
}
