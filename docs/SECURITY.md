# Bedrohungsmodell

## Kontext

Overlay läuft auf einem Homeserver in einem WLAN, das mit anderen Wohnungen
geteilt wird — das lokale Netzwerk gilt daher **nicht** als vertrauenswürdig.
Gleichzeitig soll das Dashboard auch von unterwegs erreichbar sein.

## Zwei Schutzschichten

1. **Netzwerk-Layer (primär): Tailscale.** Der Server bindet ausschließlich an
   die Tailscale-Interface-Adresse (`BIND_ADDRESS`), nie an `0.0.0.0` oder die
   LAN-Adresse. Nur Geräte im eigenen Tailnet (iPad + Homeserver) können das
   Dashboard überhaupt erreichen — weder Mitbewohner im selben WLAN noch das
   öffentliche Internet. `tailscale funnel` wird bewusst nicht verwendet, da
   das den Server öffentlich exponieren würde.
2. **App-Layer (sekundär): Login.** Ein einzelner Benutzer
   (Benutzername/bcrypt-Passwort-Hash aus `.env`), signierter httpOnly-
   Session-Cookie. Dient als zweite Verteidigungslinie, falls die
   Netzwerkschicht versagt (z.B. Fehlkonfiguration), nicht als alleiniger
   Schutz.

Beide Schichten sind bewusst redundant: Tailscale schützt vor Netzwerk-
Exposure, der App-Login vor unbefugtem Zugriff durch andere Tailnet-Mitglieder
oder falls der Bind-Adresse-Schutz versehentlich umgangen wird.

## Angriffsflächen im Detail

- **Path Traversal (Dateien/Terminal-Arbeitsverzeichnis):** Jeder
  Projektpfad wird serverseitig aus `APPS_ROOT + dirName` zusammengesetzt
  (`projects/projects.registry.ts`), nie aus einem client-gelieferten
  Absolutpfad. Die Datei-API validiert zusätzlich in
  `files/safe-path.ts`, dass ein aufgelöster Pfad (inkl. Symlink-Auflösung)
  innerhalb des Projekt-Roots bleibt.
- **Session-Fixation/-Diebstahl:** Session-Cookie ist `httpOnly` (kein
  JS-Zugriff), `SameSite=Lax`, und (produktiv) `Secure`. Session-IDs sind
  kryptographisch zufällig (32 Byte) und zusätzlich HMAC-signiert.
- **Brute-Force auf Login:** Einfaches In-Memory-Backoff pro IP mit
  exponentiell wachsender Sperrzeit.
- **Command Injection über PM2/pty:** `startScript` wird nur beim
  Registrieren eines Projekts akzeptiert (Admin-Aktion, kein öffentlicher
  Endpunkt), nicht bei jedem Start neu vom Client geliefert. Der pty-Prozess
  (`claude`/`CLAUDE_COMMAND`) wird ohne von außen kontrollierbare Argumente
  gestartet.
- **Kein Schreibzugriff über die Datei-API:** Die Files-API ist in v1
  bewusst nur lesend — Bearbeitung von Code passiert ausschließlich über die
  Claude-Code-CLI-Session selbst, nicht über einen zusätzlichen Web-Editor.

## Bekannte Grenzen (v1)

- Ein Neustart des Overlay-Servers beendet alle laufenden `claude`-pty-
  Sessions und deren In-Memory-Scrollback. Das ist ein akzeptiertes Trade-off
  für v1, keine Sicherheitslücke.
- Es gibt genau einen Benutzer/ein Passwort — kein Mehrbenutzerkonzept, keine
  granularen Rollen. Für ein persönliches Homeserver-Dashboard angemessen.
