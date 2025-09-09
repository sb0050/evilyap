# Solution pour l'erreur de listener Vercel

## Problème identifié

L'erreur que vous avez rencontrée est liée à un problème de compatibilité entre le serveur Express et le serveur de développement Vercel :

```
Typerror: listener is not a function
```

Cette erreur se produit car le serveur de développement Vercel (`vercel dev`) tente d'utiliser votre application Express d'une manière qui n'est pas compatible avec la façon dont elle est configurée.

## Modifications apportées

### 1. Modification de `server.ts`

Le fichier `server.ts` a été modifié pour exporter l'application Express, ce qui permet à Vercel de l'utiliser comme un middleware :

```typescript
// Démarrer le serveur si ce n'est pas importé par un autre module
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Exporter l'application pour Vercel
export default app;
```

### 2. Création de `vercel.dev.js`

Un fichier `vercel.dev.js` a été créé pour servir de point d'entrée pour le développement local avec Vercel. Ce fichier importe votre application Express et la configure pour être utilisée avec le serveur de développement Vercel.

### 3. Mise à jour de `vercel.json`

Le fichier `vercel.json` a été mis à jour pour inclure une commande de développement :

```json
"devCommand": "npm run dev",
```

### 4. Mise à jour du script de test local

Le script `test-vercel-local.ps1` a été modifié pour utiliser `npm run dev` au lieu de `vercel dev`, ce qui contourne le problème de compatibilité.

## Comment tester le backend

### Option 1 : Utiliser le script de test local

```powershell
# Dans le répertoire du backend
./test-vercel-local.ps1
```

Le script vous demandera quelle méthode vous souhaitez utiliser :
1. `npm run dev` (recommandé) - Utilise directement le serveur Express
2. `vercel dev` - Utilise le serveur de développement Vercel

### Option 2 : Utiliser npm directement

```bash
# Pour utiliser Express directement (recommandé)
npm run dev

# Pour utiliser Vercel dev (peut causer des erreurs)
npm run vercel:dev
```

Assurez-vous que votre fichier `.env` contient toutes les variables d'environnement nécessaires.

## Pourquoi cette approche fonctionne

Le problème vient du fait que `vercel dev` tente de traiter votre application Express comme une fonction serverless, mais votre application était configurée pour fonctionner comme un serveur autonome. Les modifications apportées permettent à votre application de fonctionner dans les deux contextes :

1. Comme un serveur autonome lorsqu'elle est exécutée directement avec `npm run dev`
2. Comme une fonction serverless lorsqu'elle est déployée sur Vercel

Cette approche est plus fiable que d'essayer de faire fonctionner `vercel dev` localement, qui peut parfois poser des problèmes de compatibilité avec certaines configurations d'applications Express.