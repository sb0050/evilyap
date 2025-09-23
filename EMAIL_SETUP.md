# Configuration de l'envoi d'emails

Ce guide vous explique comment configurer l'envoi d'emails automatiques pour les confirmations de commande.

## 📧 Configuration Gmail (Recommandée)

### 1. Activer l'authentification à deux facteurs
- Allez dans votre compte Google : https://myaccount.google.com/
- Sécurité → Authentification à 2 facteurs → Activez-la

### 2. Générer un mot de passe d'application
- Allez dans : https://myaccount.google.com/apppasswords
- Sélectionnez "Autre (nom personnalisé)"
- Tapez "Live Shopping App"
- Copiez le mot de passe généré (16 caractères)

### 3. Configurer les variables d'environnement
Dans votre fichier `.env` du backend :

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre-email@gmail.com
SMTP_PASS=votre-mot-de-passe-application
```

## 🔧 Autres fournisseurs SMTP

### Outlook/Hotmail
```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre-email@outlook.com
SMTP_PASS=votre-mot-de-passe
```

### Yahoo Mail
```env
SMTP_HOST=smtp.mail.yahoo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre-email@yahoo.com
SMTP_PASS=votre-mot-de-passe-application
```

### SendGrid (Service professionnel)
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=votre-api-key-sendgrid
```

## ✅ Test de la configuration

Une fois configuré, les emails seront automatiquement envoyés lors des paiements réussis :

1. **Email au client** : Confirmation de commande avec détails
2. **Email au propriétaire** : Notification de nouvelle vente

## 🚨 Dépannage

### Erreur "Invalid login"
- Vérifiez que l'authentification à 2 facteurs est activée
- Utilisez un mot de passe d'application, pas votre mot de passe principal

### Erreur "Connection timeout"
- Vérifiez les paramètres SMTP_HOST et SMTP_PORT
- Assurez-vous que votre pare-feu n'bloque pas le port 587

### Emails non reçus
- Vérifiez les dossiers spam/indésirables
- Vérifiez que l'adresse email du propriétaire de la boutique est correcte dans Supabase

## 📝 Personnalisation

Les templates d'emails se trouvent dans `backend/services/emailService.ts`. Vous pouvez :
- Modifier le design HTML
- Changer les couleurs et styles
- Ajouter votre logo
- Personnaliser les messages

## 🔒 Sécurité

- Ne jamais commiter le fichier `.env` dans Git
- Utilisez des mots de passe d'application, jamais vos mots de passe principaux
- Changez régulièrement vos clés API