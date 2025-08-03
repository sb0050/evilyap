# Makefile pour LM OUTLET

.PHONY: install dev server frontend clean help

# Couleurs pour les messages
GREEN=\033[0;32m
YELLOW=\033[1;33m
CYAN=\033[0;36m
NC=\033[0m # No Color

help: ## Afficher l'aide
	@echo "$(GREEN)🚀 LM OUTLET - Commandes disponibles:$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "$(CYAN)%-15s$(NC) %s\n", $$1, $$2}'

install: ## Installer toutes les dépendances
	@echo "$(YELLOW)📦 Installation des dépendances frontend...$(NC)"
	npm install
	@echo "$(YELLOW)📦 Installation des dépendances serveur...$(NC)"
	cd server && npm install
	@echo "$(GREEN)✅ Toutes les dépendances sont installées$(NC)"

dev: ## Démarrer le serveur et le frontend en mode développement
	@echo "$(GREEN)🚀 Démarrage de l'application...$(NC)"
	@echo "$(CYAN)📱 Frontend: http://localhost:3000$(NC)"
	@echo "$(CYAN)🔧 Backend:  http://localhost:5000$(NC)"
	npm run dev

server: ## Démarrer seulement le serveur backend
	@echo "$(YELLOW)🔧 Démarrage du serveur backend...$(NC)"
	cd server && npm run dev

frontend: ## Démarrer seulement le frontend
	@echo "$(YELLOW)⚛️  Démarrage du frontend React...$(NC)"
	npm start

clean: ## Nettoyer les node_modules
	@echo "$(YELLOW)🧹 Nettoyage des dépendances...$(NC)"
	rm -rf node_modules
	rm -rf server/node_modules
	@echo "$(GREEN)✅ Nettoyage terminé$(NC)"

build: ## Construire l'application pour la production
	@echo "$(YELLOW)🏗️  Construction de l'application...$(NC)"
	npm run build
	@echo "$(GREEN)✅ Application construite$(NC)"

test: ## Lancer les tests
	@echo "$(YELLOW)🧪 Lancement des tests...$(NC)"
	npm test
