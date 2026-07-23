# npm-kerberos-proxy

Correctif pour npm derrière un proxy d'entreprise qui exige une authentification
**Kerberos/Negotiate** (SSPI) — que `npm`/`@npmcli/agent` ne supporte pas
nativement (seul Basic est géré).

## Pourquoi

`npm` ne sait faire du CONNECT proxy qu'en Basic (identifiants dans l'URL
`http://user:pass@proxy:8080`). Sur un poste Windows joint à un domaine
Active Directory, derrière un proxy qui exige Negotiate (Kerberos/NTLM),
npm échoue systématiquement avec des `407 authenticationrequired`, même
avec un ticket Kerberos valide en cache (`klist`).

Ce dépôt fournit un agent proxy alternatif, basé sur
[`kerberos`](https://github.com/mongodb-js/kerberos) (le binding SSPI/GSSAPI
utilisé par le driver MongoDB), et un installeur qui le greffe dans
l'installation npm locale.

## Utilisation

1. Télécharge `Install-NpmKerberosProxy-win32-x64.ps1` depuis la
   [dernière release](../../releases/latest).
2. Exécute-le (PowerShell, pas besoin de droits admin si npm est installé
   dans le profil utilisateur — typique avec nvm-windows) :

   ```powershell
   # Si la politique d'exécution bloque le script :
   powershell -ExecutionPolicy Bypass -File .\Install-NpmKerberosProxy-win32-x64.ps1
   ```

   Ou en une seule ligne dans PowerShell :

   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; .\Install-NpmKerberosProxy-win32-x64.ps1
   ```

3. Vérifie :

   ```powershell
   npm ping
   ```

Le script est **100% hors-ligne** : le binaire natif et le code de l'agent
sont embarqués en base64 à l'intérieur du `.ps1`, aucun téléchargement n'est
nécessaire pour l'installation elle-même.

### Désinstallation

```powershell
.\Install-NpmKerberosProxy-win32-x64.ps1 -Uninstall
```

Restaure le `proxy.js` d'origine depuis la sauvegarde automatique
(`proxy.js.orig`, créée au premier passage).

## Comment ça marche

- **Détection automatique** : l'agent tente d'abord une connexion sans
  authentification. Si le proxy répond `407` avec `Proxy-Authenticate: Negotiate`,
  il négocie via SSPI (Kerberos si un ticket valide existe, avec repli NTLM
  géré par Windows). Si le proxy propose autre chose et que des identifiants
  Basic sont présents dans l'URL du proxy, il les utilise. Aucune variable
  d'environnement ni configuration `.npmrc` supplémentaire n'est requise.
- **Patch chirurgical** : le script ne remplace pas `proxy.js` en entier — il
  cherche un point d'ancrage textuel précis et exact. Si la structure ne
  correspond pas à ce qui est attendu (autre version de `@npmcli/agent`), il
  **abandonne proprement** plutôt que de corrompre le fichier.
- **Repli silencieux** : si le module `kerberos` ne charge pas (mauvaise
  architecture, etc.), npm retombe sur son comportement standard
  (`HttpsProxyAgent`) avec un simple avertissement — jamais de crash.

## Tests automatisés

Chaque push déclenche deux niveaux de test avant toute publication :

- **`test-unit`** (Linux, rapide) : logique de l'agent (machine à états,
  parsing des réponses `CONNECT`, détection du mode d'auth) contre un vrai
  serveur TCP local qui simule le proxy, avec `kerberos` mocké via
  `node:test`. Inclut une régression permanente pour le bug rencontré en
  conditions réelles (challenge `Negotiate` vide suivi d'un corps HTML pris
  à tort pour un token).
- **`test-windows`** (`windows-latest` réel) : le patch est appliqué à une
  vraie installation npm, avec vérification de l'idempotence, de la
  désinstallation, et que `require('kerberos')` charge effectivement le
  binaire natif.

Ce que la CI **ne peut pas** tester : une vraie négociation SPNEGO contre un
proxy d'entreprise (aucun domaine Active Directory sur les runners
GitHub-hosted). Cette partie a été validée manuellement en conditions
réelles contre un Skyhigh Secure Web Gateway.

```powershell
npm test
```

## Limitations connues

- **Windows x64 uniquement.** `mongodb-js/kerberos` ne publie pas de prebuild
  ARM64 pour Windows à ce jour ; ce dépôt ne peut donc pas en fournir. Si un
  prebuild apparaît en amont, l'ajout est trivial (voir
  `.github/workflows/release.yml`).
- **Modifie des fichiers internes non documentés de npm** (`node_modules/npm/node_modules/@npmcli/agent`).
  Ce n'est pas une API publique garantie stable par l'équipe npm — une mise à
  jour majeure de npm peut nécessiter une nouvelle version de ce patch. Le
  script détecte ce cas et refuse de patcher plutôt que de corrompre un
  fichier qu'il ne reconnaît pas.
- Testé avec nvm-windows et une installation Node globale standard. Pas
  encore testé avec Volta ou nodist — contributions bienvenues.
- Testé en conditions réelles contre un **Skyhigh Secure Web Gateway**
  (ex-McAfee Web Gateway). D'autres proxies d'entreprise (Blue Coat, Zscaler,
  Squid+Kerberos...) devraient fonctionner de la même façon (SPNEGO standard)
  mais n'ont pas été testés spécifiquement.

## Sécurité et transparence

- Format **PowerShell en clair**, pas de binaire compilé opaque — auditable
  avant exécution.
- Le binaire natif embarqué est le **prebuild officiel non modifié** de
  `mongodb-js/kerberos`, récupéré directement depuis ses releases GitHub par
  la CI. Le hash SHA-256 est vérifié à la génération (voir le workflow).
- Sauvegarde automatique avant toute modification, désinstallation en une
  commande.

## Licence

MIT pour le code de ce dépôt. Le binaire `kerberos.node` embarqué provient de
[mongodb-js/kerberos](https://github.com/mongodb-js/kerberos) (Apache-2.0) —
voir `NOTICE`.

## Origine

Ce projet est né du diagnostic complet d'un cas réel (npm cassé par un patch
maison défaillant, proxy Skyhigh SWG, environnement Active Directory) —
tout le raisonnement est reproductible à partir des fichiers source de ce
dépôt.
