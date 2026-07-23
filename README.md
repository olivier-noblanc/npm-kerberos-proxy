# npm-kerberos-proxy

**[Français](#en-français) | [English](#in-english)**

---

## En Français

Agent proxy alternatif pour `npm` sur les postes Windows derrière un proxy d'entreprise exigeant une authentification **Kerberos/Negotiate** (SSPI) — que `npm` ne supporte pas nativement (seul Basic est géré).

### Pourquoi

`npm` ne saitétablir une connexion proxy qu'en Basic (identifiants dans l'URL
`http://user:pass@proxy:8080`). Sur un poste Windows joint à un domaine
Active Directory, derrière un proxy exigeant Negotiate (Kerberos/NTLM),
npm échoue systématiquement avec des erreurs `407 authenticationrequired`,
même avec un ticket Kerberos valide en cache (`klist`).

Ce dépôt fournit un agent proxy basé sur
[`kerberos`](https://github.com/mongodb-js/kerberos) (le binding SSPI/GSSAPI
utilisé par le driver MongoDB), ainsi qu'un installeur qui l'intègre dans
l'installation npm locale.

### Utilisation

1. Télécharger `Install-NpmKerberosProxy-win32-x64.ps1` depuis la
   [dernière release](../../releases/latest).

2. Exécuter (PowerShell) — aucun droit admin requis si npm est dans le profil
   utilisateur (typique avec nvm-windows ou scoop) :

   ```powershell
   # Si la politique d'exécution bloque le script :
   powershell -ExecutionPolicy Bypass -File .\Install-NpmKerberosProxy-win32-x64.ps1
   ```

   Ou en une seule ligne :

   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; .\Install-NpmKerberosProxy-win32-x64.ps1
   ```

3. Vérifier :

   ```powershell
   npm ping
   ```

Le script est **100% hors-ligne** : le binaire natif et le code de l'agent
sont embarqués en base64 à l'intérieur du `.ps1`, aucun téléchargement n'est
nécessaire pour l'installation.

#### Désinstallation

```powershell
.\Install-NpmKerberosProxy-win32-x64.ps1 -Uninstall
```

Restaure le `proxy.js` d'origine depuis la sauvegarde automatique
(`proxy.js.orig`, créée au premier passage).

### Fonctionnement

- **Détection automatique** : l'agent tente d'abord une connexion sans
  authentification. Si le proxy répond `407` avec `Proxy-Authenticate: Negotiate`,
  il négocie via SSPI (Kerberos si un ticket valide existe, avec repli NTLM
  géré par Windows). Si le proxy propose autre chose et que des identifiants
  Basic sont présents dans l'URL du proxy, il les utilise. Aucune variable
  d'environnement ni configuration `.npmrc` supplémentaire n'est requise.

- **Patch précis** : le script ne remplace pas `proxy.js` en entier — il
  cherche un point d'ancrage textuel précis. Si la structure ne correspond pas
  à ce qui est attendu (autre version de `@npmcli/agent`), il abandonne
  proprement plutôt que de corrompre le fichier.

- **Repli silencieux** : si le module `kerberos` ne charge pas (mauvaise
  architecture, etc.), npm retombe sur son comportement standard
  (`HttpsProxyAgent`) avec un simple avertissement — pas de crash.

### Tests automatisés

Chaque push déclenche deux niveaux de test :

- **`test-unit`** (Linux, rapide) : logique de l'agent (machine à états,
  parsing des réponses `CONNECT`, détection du mode d'auth) contre un vrai
  serveur TCP local simulant le proxy, avec `kerberos` mocké via `node:test`.

- **`test-windows`** (`windows-latest` réel) : le patch est appliqué à une
  vraie installation npm, avec vérification que tout fonctionne correctly
  et que `require('kerberos')` charge le binaire natif.

```powershell
npm test
```

### Limitations

- **Windows x64 uniquement.** `mongodb-js/kerberos` ne publie pas de prebuild
  ARM64 pour Windows à ce jour.
- **Modifie des fichiers internes non documentés de npm** (`node_modules/npm/node_modules/@npmcli/agent`).
  Une mise à jour majeure de npm peut nécessiter une nouvelle version de ce patch.
- Testé avec nvm-windows, scoop et une installation Node globale standard.
  Contributions bienvenues pour Volta ou nodist.
- Testé en conditions réelles contre un **Skyhigh Secure Web Gateway**
  (ex-McAfee Web Gateway). Devrait fonctionner avec tout proxy supportant
  SPNEGO (Blue Coat, Zscaler, Squid+Kerberos...).

### Sécurité

- Format **PowerShell en clair**, pas de binaire compilé opaque — auditable
  avant exécution.
- Le binaire natif embarqué est le **prebuild officiel non modifié** de
  `mongodb-js/kerberos`, récupéré directement depuis ses releases GitHub par
  la CI.
- Sauvegarde automatique avant toute modification, désinstallation en une
  commande.

### Licence

MIT pour le code de ce dépôt. Le binaire `kerberos.node` embarqué provient de
[mongodb-js/kerberos](https://github.com/mongodb-js/kerberos) (Apache-2.0) —
voir `NOTICE`.

---

## In English

Alternative proxy agent for `npm` on Windows machines behind a corporate proxy
requiring **Kerberos/Negotiate** (SSPI) authentication — which `npm` does not
support natively (only Basic is handled).

### Why

`npm` can only connect to proxies using Basic authentication (credentials in the
URL `http://user:pass@proxy:8080`). On a Windows machine joined to an Active
Directory domain, behind a proxy requiring Negotiate (Kerberos/NTLM), npm fails
with `407 authenticationrequired` errors, even with a valid Kerberos ticket in
cache (`klist`).

This repository provides a proxy agent based on
[`kerberos`](https://github.com/mongodb-js/kerberos) (the SSPI/GSSAPI binding
used by the MongoDB driver), along with an installer that integrates it into the
local npm installation.

### Usage

1. Download `Install-NpmKerberosProxy-win32-x64.ps1` from the
   [latest release](../../releases/latest).

2. Run it (PowerShell) — no admin rights required if npm is installed in the
   user profile (typical with nvm-windows or scoop):

   ```powershell
   # If the execution policy blocks the script:
   powershell -ExecutionPolicy Bypass -File .\Install-NpmKerberosProxy-win32-x64.ps1
   ```

   Or in a single PowerShell line:

   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; .\Install-NpmKerberosProxy-win32-x64.ps1
   ```

3. Verify:

   ```powershell
   npm ping
   ```

The script is **100% offline**: the native binary and agent code are embedded
as base64 inside the `.ps1` — no download is required during installation.

#### Uninstallation

```powershell
.\Install-NpmKerberosProxy-win32-x64.ps1 -Uninstall
```

Restores the original `proxy.js` from the automatic backup
(`proxy.js.orig`, created on first run).

### How it works

- **Automatic detection**: the agent first attempts a connection without
  authentication. If the proxy responds with `407` and `Proxy-Authenticate: Negotiate`,
  it negotiates via SSPI (Kerberos if a valid ticket exists, with NTLM fallback
  managed by Windows). If the proxy offers something else and Basic credentials
  are present in the proxy URL, it uses them. No additional environment variables
  or `.npmrc` configuration is needed.

- **Surgical patch**: the script does not replace `proxy.js` entirely — it
  finds a precise text anchor. If the structure does not match expectations
  (different version of `@npmcli/agent`), it aborts cleanly rather than
  corrupting the file.

- **Silent fallback**: if the `kerberos` module fails to load (wrong
  architecture, etc.), npm falls back to its standard behavior
  (`HttpsProxyAgent`) with a simple warning — no crash.

### Automated tests

Each push triggers two levels of testing:

- **`test-unit`** (Linux, fast): agent logic (state machine, `CONNECT`
  response parsing, auth mode detection) against a real local TCP server
  simulating the proxy, with `kerberos` mocked via `node:test`.

- **`test-windows`** (`windows-latest`): the patch is applied to a real npm
  installation, verifying correct operation and that `require('kerberos')`
  loads the native binary.

```powershell
npm test
```

### Known limitations

- **Windows x64 only.** `mongodb-js/kerberos` does not publish ARM64 prebuilds
  for Windows at this time.
- **Modifies undocumented internal npm files** (`node_modules/npm/node_modules/@npmcli/agent`).
  A major npm update may require a new version of this patch.
- Tested with nvm-windows, scoop, and standard global Node installations.
  Contributions welcome for Volta or nodist.
- Tested against a **Skyhigh Secure Web Gateway** (formerly McAfee Web Gateway).
  Should work with any proxy supporting SPNEGO (Blue Coat, Zscaler,
  Squid+Kerberos, etc.).

### Security

- **Clear PowerShell format**, no opaque compiled binary — auditable before
  execution.
- The embedded native binary is the **unmodified official prebuild** from
  `mongodb-js/kerberos`, fetched directly from its GitHub releases by CI.
- Automatic backup before any modification, one-command uninstallation.

### License

MIT for this repository's code. The embedded `kerberos.node` binary comes from
[mongodb-js/kerberos](https://github.com/mongodb-js/kerberos) (Apache-2.0) —
see `NOTICE`.
