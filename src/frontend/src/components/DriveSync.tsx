import { useCallback, useEffect, useState } from 'react';
import {
  connectDrive, disconnectDrive, getDriveStatus, pullFromDrive, pushToDrive,
  type DriveStatus, type DriveSyncResult,
} from '../api';
import { mirrorToServer, putAll } from '../lib/recipeStore';
import './DriveSync.css';

/**
 * Connecting a Google Drive and syncing recipes to it as Markdown.
 *
 * Renders NOTHING unless the server says Drive is enabled (settings.yml):
 * this is the one feature that leaves the machine, and someone who hasn't
 * turned it on shouldn't have to look at it.
 *
 * The setup has a step no program can do for the user -- creating an OAuth
 * client in Google Cloud -- so when the server reports `configured: false`
 * this shows exactly what to do, including the redirect URI to paste, which
 * has to match character for character.
 *
 * Pulling stores what comes down in THIS BROWSER (lib/recipeStore.ts), which
 * is where the library lives; `onLibraryChange` lets the page around it
 * re-render with the new recipes.
 */
export default function DriveSync({ onLibraryChange }: { onLibraryChange?: () => void } = {}) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DriveSyncResult | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setStatus(await getDriveStatus());
    } catch {
      // The endpoint only exists on a server new enough to have it; an old
      // one just means "no Drive here", which is not worth an error.
      setStatus(null);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Coming back from Google's consent screen lands on /api/drive/callback,
  // which is a different tab. Re-checking on focus is what makes the panel
  // notice the connection without a manual reload.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  async function run(action: () => Promise<DriveSyncResult>) {
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const data = await action();
      if (!data.ok) {
        setError(data.error || 'No se pudo sincronizar.');
      } else {
        // A pull brings the recipes back with it: the library lives in this
        // browser, so they land in IndexedDB and the server's mirror is
        // brought back in step afterwards.
        if (data.result?.recipes?.length) {
          await putAll(data.result.recipes);
          await mirrorToServer();
          onLibraryChange?.();
        }
        setReport(data);
      }
    } catch (err) {
      setError('No se pudo hablar con el servidor.');
      console.error(err);
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function handleConnect() {
    setBusy(true);
    setError('');
    try {
      const data = await connectDrive();
      if (data.auth_url) window.location.href = data.auth_url;
      else setError(data.error || 'No se pudo iniciar la conexión.');
    } catch (err) {
      setError('No se pudo hablar con el servidor.');
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (!status?.enabled) return null;

  return (
    <section className="drive-panel">
      <header className="drive-head">
        <h2>Google Drive</h2>
        <span className={`drive-dot ${status.connected ? 'on' : ''}`} />
      </header>

      {!status.configured && (
        <div className="drive-setup">
          <p>
            Falta el paso de Google Cloud, que solo puedes hacer tú: crea un
            <b> OAuth client ID</b> de tipo <b>Aplicación web</b>, añádele esta URI
            de redirección exacta y guarda el JSON como <code>src/drive_client.json</code>.
          </p>
          <code className="drive-uri">{status.redirect_uri}</code>
        </div>
      )}

      {status.configured && !status.connected && (
        <>
          <p className="drive-hint">
            Tus {status.local_recipes} recetas se guardarán como Markdown en una
            carpeta <b>{status.folder}</b> de tu Drive. Cook-It solo ve los ficheros
            que crea él.
          </p>
          <button className="drive-btn primary" disabled={busy} onClick={() => void handleConnect()}>
            Conectar Google Drive
          </button>
        </>
      )}

      {status.connected && (
        <>
          <p className="drive-hint">
            Conectado. Carpeta <b>{status.folder}</b>.
          </p>
          <div className="drive-actions">
            <button className="drive-btn" disabled={busy} onClick={() => void run(pushToDrive)}>
              ⬆ Subir mis recetas
            </button>
            <button className="drive-btn" disabled={busy} onClick={() => void run(pullFromDrive)}>
              ⬇ Traer de Drive
            </button>
            <button className="drive-link" disabled={busy} onClick={() => void disconnectDrive().then(refresh)}>
              Desconectar
            </button>
          </div>
        </>
      )}

      {busy && <p className="drive-hint">Sincronizando…</p>}
      {error && <p className="drive-error">{error}</p>}
      {report?.result && <DriveReport result={report.result} />}
    </section>
  );
}

/** What the sync actually did, in the user's terms -- a count with the
 *  filenames behind it, and anything it refused to touch said out loud. */
function DriveReport({ result }: { result: NonNullable<DriveSyncResult['result']> }) {
  const name = (entry: string | { file: string }) => (typeof entry === 'string' ? entry : entry.file);
  const lines: string[] = [];
  if (result.created?.length) lines.push(`${result.created.length} subidas por primera vez`);
  if (result.updated?.length) lines.push(`${result.updated.length} actualizadas`);
  if (result.added?.length) lines.push(`${result.added.length} nuevas traídas`);

  return (
    <div className="drive-report">
      {lines.length > 0 ? <p>{lines.join(' · ')}</p> : <p>Nada que cambiar.</p>}
      {result.skipped?.map((s) => (
        <p key={s.file} className="drive-skipped">
          <b>{s.file}</b>: sin tocar — {s.reason}
        </p>
      ))}
      {result.failed?.map((f) => (
        <p key={f.file} className="drive-error">
          <b>{f.file}</b>: {f.error}
        </p>
      ))}
      {(result.created?.length || result.updated?.length || result.added?.length) && (
        <details>
          <summary>Ver ficheros</summary>
          <ul>
            {[...(result.created ?? []), ...(result.updated ?? []), ...(result.added ?? [])].map((e, i) => (
              <li key={i}>{name(e)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
