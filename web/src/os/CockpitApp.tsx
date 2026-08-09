import { useEffect } from "react";

const COCKPIT_PORT = 9090;

function cockpitUrl(): string {
  return `https://${window.location.hostname}:${COCKPIT_PORT}/`;
}

/**
 * Öffnet Cockpit in einem eigenen, benannten Tab statt "_blank" — dadurch
 * fokussiert ein erneutes Antippen des App-Icons den bereits offenen Tab
 * neu, statt Duplikate aufzumachen. So fühlt es sich wie ein Umschalten
 * zwischen zwei Apps an statt wie wiederholtes Neuöffnen.
 */
export function CockpitApp() {
  const url = cockpitUrl();

  useEffect(() => {
    window.open(url, "overlay-cockpit", "noopener");
  }, [url]);

  return (
    <div className="cockpit-app">
      <p className="cockpit-app-text">Cockpit öffnet sich in einem eigenen Tab.</p>
      <a className="cockpit-app-link" href={url} target="overlay-cockpit" rel="noreferrer noopener">
        {url}
      </a>
    </div>
  );
}
