// Stub de test : mock.module() dans les tests remplace ces exports.
// Ce fichier existe uniquement pour que require.resolve('kerberos')
// reussisse avant l'interception par le mock. Ne jamais publier ce stub
// comme dependance reelle - voir .github/workflows pour le vrai binaire.
module.exports = {}
