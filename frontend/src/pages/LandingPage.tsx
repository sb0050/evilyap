import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Play, Star, Users, CreditCard, Shield, Zap } from 'lucide-react';

const LandingPage = () => {
  const [currentSlide, setCurrentSlide] = useState(0);

  const heroSlides = [
    {
      title: "Révolutionnez vos paiements en ligne",
      subtitle: "PayLive simplifie vos transactions avec Stripe et optimise vos livraisons avec Boxtal",
      image: "/api/placeholder/600/400",
      cta: "Commencer gratuitement",
      highlight: "Nouveau"
    },
    {
      title: "Gestion complète des commandes",
      subtitle: "Suivez vos ventes, gérez vos clients et optimisez vos livraisons depuis une seule plateforme",
      image: "/api/placeholder/600/400",
      cta: "Découvrir les fonctionnalités",
      highlight: "Populaire"
    },
    {
      title: "Sécurité et fiabilité garanties",
      subtitle: "Paiements sécurisés avec Stripe, authentification Clerk et infrastructure robuste",
      image: "/api/placeholder/600/400",
      cta: "En savoir plus",
      highlight: "Sécurisé"
    }
  ];

  const features = [
    {
      icon: <CreditCard className="h-8 w-8 text-blue-600" />,
      title: "Paiements Stripe",
      description: "Intégration complète avec Stripe pour des paiements sécurisés et rapides"
    },
    {
      icon: <Shield className="h-8 w-8 text-green-600" />,
      title: "Authentification Clerk",
      description: "Gestion des utilisateurs simplifiée avec Clerk"
    },
    {
      icon: <Zap className="h-8 w-8 text-yellow-600" />,
      title: "Livraisons Boxtal",
      description: "Optimisation des livraisons avec l'API Boxtal"
    },
    {
      icon: <Users className="h-8 w-8 text-purple-600" />,
      title: "Gestion clients",
      description: "Interface intuitive pour gérer vos clients et commandes"
    }
  ];

  const testimonials = [
    {
      name: "Marie Dubois",
      role: "E-commerce Manager",
      content: "PayLive a transformé notre processus de paiement. Simple, rapide et fiable.",
      rating: 5
    },
    {
      name: "Pierre Martin",
      role: "Startup Founder",
      content: "L'intégration avec Stripe et Boxtal nous fait gagner un temps précieux.",
      rating: 5
    },
    {
      name: "Sophie Laurent",
      role: "Product Manager",
      content: "Interface moderne et fonctionnalités complètes. Exactement ce qu'il nous fallait.",
      rating: 5
    }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroSlides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % heroSlides.length);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + heroSlides.length) % heroSlides.length);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">PayLive</h1>
            </div>
            <nav className="hidden md:flex space-x-8">
              <a href="#features" className="text-gray-600 hover:text-gray-900">Fonctionnalités</a>
              <a href="#testimonials" className="text-gray-600 hover:text-gray-900">Témoignages</a>
              <a href="#pricing" className="text-gray-600 hover:text-gray-900">Tarifs</a>
              <a href="#faq" className="text-gray-600 hover:text-gray-900">FAQ</a>
            </nav>
            <div className="flex items-center space-x-4">
              <Link to="/checkout" className="text-gray-600 hover:text-gray-900">Connexion</Link>
              <Link to="/checkout" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                Commencer
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Carousel */}
      <section className="relative bg-gradient-to-br from-blue-50 to-indigo-100 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="relative">
            {/* Carousel Content */}
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-8">
                {/* Highlight Badge */}
                <div className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  <span className="w-2 h-2 bg-blue-600 rounded-full mr-2"></span>
                  {heroSlides[currentSlide].highlight}
                </div>
                
                {/* Title */}
                <h1 className="text-4xl lg:text-6xl font-bold text-gray-900 leading-tight">
                  {heroSlides[currentSlide].title}
                </h1>
                
                {/* Subtitle */}
                <p className="text-xl text-gray-600 leading-relaxed">
                  {heroSlides[currentSlide].subtitle}
                </p>
                
                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link 
                    to="/checkout" 
                    className="bg-blue-600 text-white px-8 py-4 rounded-lg hover:bg-blue-700 transition-colors font-semibold text-lg inline-flex items-center justify-center"
                  >
                    {heroSlides[currentSlide].cta}
                  </Link>
                  <button className="border border-gray-300 text-gray-700 px-8 py-4 rounded-lg hover:bg-gray-50 transition-colors font-semibold text-lg inline-flex items-center justify-center">
                    <Play className="h-5 w-5 mr-2" />
                    Voir la démo
                  </button>
                </div>
                
                {/* Stats */}
                <div className="flex items-center space-x-8 pt-8">
                  <div>
                    <div className="text-2xl font-bold text-gray-900">10k+</div>
                    <div className="text-sm text-gray-600">Transactions</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">99.9%</div>
                    <div className="text-sm text-gray-600">Uptime</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">24/7</div>
                    <div className="text-sm text-gray-600">Support</div>
                  </div>
                </div>
              </div>
              
              {/* Image */}
              <div className="relative">
                <div className="bg-white rounded-2xl shadow-2xl p-8">
                  <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl h-80 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CreditCard className="h-8 w-8 text-white" />
                      </div>
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">Interface PayLive</h3>
                      <p className="text-gray-600">Gestion simplifiée de vos paiements</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Carousel Navigation */}
            <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex space-x-2">
              {heroSlides.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentSlide(index)}
                  className={`w-3 h-3 rounded-full transition-colors ${
                    index === currentSlide ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
            
            {/* Arrow Navigation */}
            <button
              onClick={prevSlide}
              className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-white rounded-full p-2 shadow-lg hover:shadow-xl transition-shadow"
            >
              <ChevronLeft className="h-6 w-6 text-gray-600" />
            </button>
            <button
              onClick={nextSlide}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-white rounded-full p-2 shadow-lg hover:shadow-xl transition-shadow"
            >
              <ChevronRight className="h-6 w-6 text-gray-600" />
            </button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              Fonctionnalités puissantes
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              PayLive combine les meilleures technologies pour vous offrir une solution complète de paiement et de livraison
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="text-center p-6 rounded-xl hover:shadow-lg transition-shadow">
                <div className="flex justify-center mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              Ce que disent nos clients
            </h2>
            <p className="text-xl text-gray-600">
              Découvrez pourquoi les entreprises choisissent PayLive
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="bg-white p-6 rounded-xl shadow-sm">
                <div className="flex items-center mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="h-5 w-5 text-yellow-400 fill-current" />
                  ))}
                </div>
                <p className="text-gray-600 mb-4 italic">"{testimonial.content}"</p>
                <div>
                  <div className="font-semibold text-gray-900">{testimonial.name}</div>
                  <div className="text-sm text-gray-500">{testimonial.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              Tarifs transparents
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Choisissez le plan qui correspond à vos besoins. Pas de frais cachés, pas d'engagement.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Starter Plan */}
            <div className="bg-white border-2 border-gray-200 rounded-xl p-8 hover:border-blue-500 transition-colors">
              <div className="text-center">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Starter</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold text-gray-900">Gratuit</span>
                </div>
                <p className="text-gray-600 mb-6">Parfait pour commencer</p>
                <ul className="text-left space-y-3 mb-8">
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-gray-700">Jusqu'à 10 transactions/mois</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-gray-700">Paiements Stripe intégrés</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-gray-700">Support email</span>
                  </li>
                </ul>
                <Link 
                  to="/checkout" 
                  className="w-full bg-gray-100 text-gray-900 py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors font-semibold inline-block text-center"
                >
                  Commencer gratuitement
                </Link>
              </div>
            </div>

            {/* Pro Plan */}
            <div className="bg-blue-600 text-white rounded-xl p-8 transform scale-105 shadow-xl">
              <div className="text-center">
                <div className="bg-yellow-400 text-blue-900 px-3 py-1 rounded-full text-sm font-semibold mb-4 inline-block">
                  Le plus populaire
                </div>
                <h3 className="text-2xl font-bold mb-2">Pro</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold">29€</span>
                  <span className="text-blue-200">/mois</span>
                </div>
                <p className="text-blue-100 mb-6">Pour les entreprises en croissance</p>
                <ul className="text-left space-y-3 mb-8">
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-yellow-400 rounded-full mr-3"></div>
                    <span className="text-blue-100">Transactions illimitées</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-yellow-400 rounded-full mr-3"></div>
                    <span className="text-blue-100">Livraisons Boxtal intégrées</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-yellow-400 rounded-full mr-3"></div>
                    <span className="text-blue-100">Gestion clients avancée</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-yellow-400 rounded-full mr-3"></div>
                    <span className="text-blue-100">Support prioritaire</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-yellow-400 rounded-full mr-3"></div>
                    <span className="text-blue-100">Analytics détaillées</span>
                  </li>
                </ul>
                <Link 
                  to="/checkout" 
                  className="w-full bg-white text-blue-600 py-3 px-6 rounded-lg hover:bg-gray-100 transition-colors font-semibold inline-block text-center"
                >
                  Choisir Pro
                </Link>
              </div>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-white border-2 border-gray-200 rounded-xl p-8 hover:border-blue-500 transition-colors">
              <div className="text-center">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Enterprise</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold text-gray-900">Sur mesure</span>
                </div>
                <p className="text-gray-600 mb-6">Pour les grandes entreprises</p>
                <ul className="text-left space-y-3 mb-8">
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-gray-700">Volume illimité</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-gray-700">API personnalisée</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-gray-700">Support dédié 24/7</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-gray-700">Formation équipe</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-gray-700">SLA garanti</span>
                  </li>
                </ul>
                <a 
                  href="mailto:contact@paylive.fr" 
                  className="w-full bg-gray-100 text-gray-900 py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors font-semibold inline-block text-center"
                >
                  Nous contacter
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              Questions fréquentes
            </h2>
            <p className="text-xl text-gray-600">
              Tout ce que vous devez savoir sur PayLive
            </p>
          </div>
          
          <div className="space-y-6">
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Comment fonctionne PayLive ?
              </h3>
              <p className="text-gray-600">
                PayLive est une solution complète qui intègre les paiements Stripe, la gestion des livraisons via Boxtal, et un système de gestion client. Vous pouvez gérer toutes vos ventes en ligne depuis une seule plateforme.
              </p>
            </div>
            
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Quels sont les frais de transaction ?
              </h3>
              <p className="text-gray-600">
                PayLive ne prend aucune commission sur vos ventes. Vous payez uniquement les frais Stripe standard (1,4% + 0,25€ par transaction en Europe) et les frais de livraison Boxtal selon vos besoins.
              </p>
            </div>
            
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Puis-je annuler mon abonnement à tout moment ?
              </h3>
              <p className="text-gray-600">
                Oui, vous pouvez annuler votre abonnement à tout moment depuis votre tableau de bord. Aucun engagement, aucune pénalité. Votre accès reste actif jusqu'à la fin de votre période de facturation.
              </p>
            </div>
            
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                PayLive est-il sécurisé ?
              </h3>
              <p className="text-gray-600">
                Absolument. PayLive utilise les standards de sécurité les plus élevés avec le chiffrement SSL, l'authentification Clerk, et s'appuie sur l'infrastructure sécurisée de Stripe pour tous les paiements.
              </p>
            </div>
            
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Quel support proposez-vous ?
              </h3>
              <p className="text-gray-600">
                Nous offrons un support email pour tous les utilisateurs, un support prioritaire pour les abonnés Pro, et un support dédié 24/7 pour les clients Enterprise. Notre équipe est là pour vous accompagner.
              </p>
            </div>
            
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Puis-je intégrer PayLive à mon site existant ?
              </h3>
              <p className="text-gray-600">
                Oui, PayLive propose une API complète et des webhooks pour s'intégrer facilement à votre site web ou application existante. Notre documentation technique vous guide pas à pas.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-blue-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
            Prêt à révolutionner vos paiements ?
          </h2>
          <p className="text-xl text-blue-100 mb-8">
            Rejoignez des milliers d'entreprises qui font confiance à PayLive
          </p>
          <Link 
            to="/checkout" 
            className="bg-white text-blue-600 px-8 py-4 rounded-lg hover:bg-gray-100 transition-colors font-semibold text-lg inline-block"
          >
            Commencer gratuitement
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <h3 className="text-xl font-bold mb-4">PayLive</h3>
              <p className="text-gray-400">
                La solution complète pour vos paiements en ligne et vos livraisons.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Produit</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white">Fonctionnalités</a></li>
                <li><a href="#" className="hover:text-white">Tarifs</a></li>
                <li><a href="#" className="hover:text-white">API</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white">Documentation</a></li>
                <li><a href="#" className="hover:text-white">Contact</a></li>
                <li><a href="#" className="hover:text-white">Status</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Entreprise</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white">À propos</a></li>
                <li><a href="#" className="hover:text-white">Blog</a></li>
                <li><a href="#" className="hover:text-white">Carrières</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
            <p>&copy; 2024 PayLive. Tous droits réservés.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;