# Intégration Boxtal - Composant Carte des Points Relais

Ce guide explique comment utiliser le composant carte Boxtal pour permettre aux utilisateurs de sélectionner un point relais.

## Configuration

### 1. Clé d'accès Boxtal
- **Clé d'accès** : `H7F652KE9XTPGYT3W7PMGUMGI0ROZ4YGECO66TUH`
- **Endpoint d'authentification** : `/api/boxtal/auth`

### 2. Réseaux supportés
- `SOGP_NETWORK` : Relais Colis
- `MONR_NETWORK` : Mondial Relay  
- `CHRP_NETWORK` : Chronopost
- `COPR_NETWORK` : Colis Privé
- `UPSE_NETWORK` : UPS
- `DHLE_NETWORK` : DHL

## Utilisation du composant

### Import et utilisation basique

```jsx
import BoxtalMap from '../components/BoxtalMap'

function CheckoutPage() {
  const [selectedParcelPoint, setSelectedParcelPoint] = useState(null)
  
  return (
    <BoxtalMap
      onParcelPointSelect={setSelectedParcelPoint}
      deliveryAddress={{
        address: "123 rue de la Paix",
        zipcode: "75001",
        city: "Paris",
        country: "FR",
        lat: 48.8566,
        lng: 2.3522
      }}
      networks={['SOGP_NETWORK', 'MONR_NETWORK', 'CHRP_NETWORK']}
      maxResults={15}
    />
  )
}
```

### Props du composant BoxtalMap

| Prop | Type | Description | Défaut |
|------|------|-------------|---------|
| `onParcelPointSelect` | Function | Callback appelé quand un point relais est sélectionné | - |
| `deliveryAddress` | Object | Adresse de livraison pour la recherche | - |
| `networks` | Array | Liste des réseaux de points relais | `['SOGP_NETWORK', 'MONR_NETWORK', 'CHRP_NETWORK']` |
| `maxResults` | Number | Nombre maximum de résultats | `10` |

### Structure de l'objet deliveryAddress

```javascript
{
  address: "123 rue de la Paix",    // Adresse complète
  zipcode: "75001",                 // Code postal
  city: "Paris",                    // Ville
  country: "FR",                    // Code pays (ISO 2 lettres)
  lat: 48.8566,                     // Latitude (optionnel)
  lng: 2.3522                       // Longitude (optionnel)
}
```

### Structure de l'objet parcelPoint retourné

```javascript
{
  id: "12345",                      // ID unique du point relais
  name: "Tabac de la Paix",         // Nom du point relais
  address: "123 rue de la Paix",    // Adresse
  zipcode: "75001",                 // Code postal
  city: "Paris",                    // Ville
  country: "FR",                    // Pays
  network: "SOGP_NETWORK",          // Réseau
  phone: "01 23 45 67 89",          // Téléphone (optionnel)
  distance: 250,                    // Distance en mètres (optionnel)
  opening_hours: {...},             // Horaires d'ouverture (optionnel)
  coordinates: {                    // Coordonnées GPS
    lat: 48.8566,
    lng: 2.3522
  }
}
```

## Installation et démarrage

### 1. Installation des dépendances serveur

```bash
cd server
npm install
```

### 2. Configuration des variables d'environnement

Créer un fichier `.env` dans le dossier `server` :

```env
# Boxtal Configuration
BOXTAL_ACCESS_KEY=H7F652KE9XTPGYT3W7PMGUMGI0ROZ4YGECO66TUH

# Application Configuration
CLIENT_URL=http://localhost:3000
PORT=5000
```

### 3. Démarrage du serveur

```bash
# Développement
npm run dev

# Production
npm start
```

## API Endpoints

### POST /api/boxtal/auth
Obtient un token d'accès pour l'API Boxtal.

**Body :**
```json
{
  "access_key": "H7F652KE9XTPGYT3W7PMGUMGI0ROZ4YGECO66TUH"
}
```

**Response :**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

### POST /api/boxtal/parcel-points
Recherche des points relais.

**Body :**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "address": "123 rue de la Paix",
  "zipcode": "75001",
  "city": "Paris",
  "country": "FR",
  "networks": ["SOGP_NETWORK", "MONR_NETWORK"],
  "max_results": 10
}
```

### GET /api/boxtal/parcel-point/:id
Obtient les détails d'un point relais spécifique.

**Query params :**
- `access_token` : Token d'accès

## Fonctionnalités du composant

### 1. Carte interactive
- Affichage des points relais sur une carte
- Zoom et navigation
- Marqueurs cliquables

### 2. Liste des points relais
- Liste détaillée à côté de la carte
- Informations complètes (nom, adresse, téléphone, distance)
- Sélection par clic

### 3. Recherche automatique
- Recherche basée sur l'adresse de livraison
- Mise à jour automatique quand l'adresse change
- Filtrage par réseaux

### 4. Gestion des erreurs
- Messages d'erreur explicites
- Bouton de rechargement
- Gestion des timeouts

## Personnalisation

### Styles CSS
Le composant utilise Tailwind CSS. Tu peux personnaliser les styles en modifiant les classes dans `BoxtalMap.jsx`.

### Réseaux de points relais
Modifie la prop `networks` pour changer les réseaux affichés :

```jsx
<BoxtalMap
  networks={['MONR_NETWORK']} // Seulement Mondial Relay
  // ou
  networks={['SOGP_NETWORK', 'CHRP_NETWORK', 'DHLE_NETWORK']} // Plusieurs réseaux
/>
```

### Nombre de résultats
Ajuste le nombre maximum de points relais affichés :

```jsx
<BoxtalMap
  maxResults={20} // Affiche jusqu'à 20 points relais
/>
```

## Dépannage

### Erreur "Failed to load BoxtalMaps SDK"
- Vérifier la connexion internet
- S'assurer que le CDN Boxtal est accessible

### Erreur d'authentification
- Vérifier que la clé d'accès est correcte
- S'assurer que le serveur est démarré
- Vérifier les logs du serveur

### Aucun point relais trouvé
- Vérifier que l'adresse est correcte et complète
- Essayer avec différents réseaux
- Augmenter le `maxResults`

## Support

Pour toute question ou problème, consulter :
- [Documentation officielle Boxtal](https://developer.boxtal.com)
- Logs du serveur pour les erreurs d'API
- Console du navigateur pour les erreurs frontend
