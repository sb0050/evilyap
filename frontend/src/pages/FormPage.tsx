import React, { useMemo, useState } from 'react';
import { apiPost } from '../utils/api';

const IMPORTANCE = [
  'Pas du tout important',
  'Peu important',
  'Pourquoi pas',
  'Important',
  'Très important pour moi',
];

const IMPORTANCE_COLORS = [
  'rgb(144, 52, 234)',
  'rgb(117, 64, 235)',
  'rgb(93, 75, 235)',
  'rgb(64, 87, 235)',
  'rgb(40, 98, 235)',
];

export default function FormPage() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<any>({
    activities: [],
    volume: '',
    priorities: {
      ventes: '',
      temps: '',
      fideliser: '',
      organisation: '',
    },
    q4_loyalty: '',
    q5_ai_reco: '',
    q6_crosssell: '',
    q7_logistics: '',
    q8_notifications: '',
    q9_assistant: '',
    q10_compta: '',
    q11_multiadmin: '',
    q12_storepage: '',
    q13_messaging: '',
    q14_obs: '',
    q15_aicoach: '',
    q16_top: '',
    q17_problem: '',
    q18_email: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const totalSteps = 20;
  const progress = useMemo(
    () => Math.round((step / (totalSteps - 1)) * 100),
    [step]
  );

  const toggleActivity = (name: string) => {
    setAnswers((prev: any) => {
      const set = new Set(prev.activities as string[]);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      return { ...prev, activities: Array.from(set) };
    });
  };

  const setPriority = (key: string, value: string) => {
    setAnswers((prev: any) => ({
      ...prev,
      priorities: { ...prev.priorities, [key]: value },
    }));
  };

  const next = () => setStep(s => Math.min(s + 1, totalSteps - 1));
  const prev = () => setStep(s => Math.max(s - 1, 0));

  const finish = async () => {
    if (
      !answers.q18_email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.q18_email)
    ) {
      setSubmitError('Email requis et valide');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        email: answers.q18_email,
        activities: answers.activities,
        volume_band: (answers.volume || '').replace('–', '-'),
        top_priority: answers.q16_top || null,
        obs_used:
          answers.q14_obs === 'Oui'
            ? true
            : answers.q14_obs === 'Non'
              ? false
              : null,
        answers: {
          priorities: answers.priorities,
          q4_loyalty: answers.q4_loyalty,
          q5_ai_reco: answers.q5_ai_reco,
          q6_crosssell: answers.q6_crosssell,
          q7_logistics: answers.q7_logistics,
          q8_notifications: answers.q8_notifications,
          q9_assistant: answers.q9_assistant,
          q10_compta: answers.q10_compta,
          q11_multiadmin: answers.q11_multiadmin,
          q12_storepage: answers.q12_storepage,
          q13_messaging: answers.q13_messaging,
          q14_obs: answers.q14_obs,
          q15_aicoach: answers.q15_aicoach,
          q17_problem: answers.q17_problem,
        },
      };
      await apiPost('/api/forms/responses', payload);
      setSubmitted(true);
    } catch (e: any) {
      setSubmitError(e?.message || 'Erreur lors de l’envoi');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className='min-h-screen w-full bg-white flex flex-col'>
      <div className='w-full p-4 sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-gray-200'>
        <div className='flex items-center justify-between'>
          <div className='text-sm font-medium text-gray-700'>
            Questionnaire Priorisation des Fonctionnalités Paylive
          </div>
          <div className='flex items-center gap-3'>
            <div className='w-40 h-2 bg-gray-200 rounded-full overflow-hidden'>
              <div
                className='h-full bg-gradient-to-r from-purple-600 to-blue-600'
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className='text-xs text-gray-600'>{progress}%</div>
          </div>
        </div>
      </div>

      <div className='flex-1 w-full max-w-xl mx-auto px-4 py-10 flex items-center'>
        <div className='w-full'>
          {step === 0 && (
            <div className='space-y-4'>
              <div className='text-2xl font-bold'>
                Aidez-nous à créer l’outil parfait pour vos lives
              </div>
              <div className='text-gray-600'>
                1 minute – vos réponses guideront les prochaines fonctionnalités
                de Paylive.
              </div>
              <button
                onClick={next}
                className='w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-3 rounded-lg font-semibold'
              >
                Commencer
              </button>
            </div>
          )}

          {step === 1 && (
            <div className='space-y-6'>
              <div className='text-xl font-semibold'>
                Quel type de vendeur êtes-vous ?
              </div>
              <div className='grid grid-cols-1 gap-3'>
                {[
                  'Boutique physique',
                  'Vendeur en ligne (Vinted / Insta / TikTok…)',
                  'Auto-entrepreneur',
                  'Marque / créateur',
                  'Autre',
                ].map(opt => (
                  <button
                    key={opt}
                    onClick={() => toggleActivity(opt)}
                    className={`w-full px-4 py-3 rounded-lg border ${answers.activities.includes(opt) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300'} transition`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className='flex gap-2'>
                <button
                  onClick={prev}
                  className='flex-1 border border-gray-300 rounded-lg py-3'
                >
                  Retour
                </button>
                <button
                  onClick={next}
                  className='flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg py-3'
                >
                  Suivant
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className='space-y-6'>
              <div className='text-xl font-semibold'>
                Combien de commandes faites-vous en moyenne par semaine ?
              </div>
              <div className='grid grid-cols-1 gap-3'>
                {['0–20', '20–50', '50–100', '100+'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => {
                      setAnswers((p: any) => ({ ...p, volume: opt }));
                      setTimeout(() => next(), 120);
                    }}
                    className={`w-full px-4 py-3 rounded-lg border ${answers.volume === opt ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300'} transition`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className='flex gap-2'>
                <button
                  onClick={prev}
                  className='flex-1 border border-gray-300 rounded-lg py-3'
                >
                  Retour
                </button>
                <button
                  onClick={next}
                  className='flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg py-3'
                >
                  Suivant
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className='space-y-6'>
              <div className='text-xl font-semibold'>
                Aujourd’hui, qu’est-ce qui est le plus important pour vous ?
              </div>
              <div className='space-y-3'>
                {[
                  { key: 'ventes', label: 'Augmenter mes ventes' },
                  { key: 'temps', label: 'Gagner du temps' },
                  { key: 'fideliser', label: 'Fidéliser mes clients' },
                  {
                    key: 'organisation',
                    label: 'Avoir une meilleure organisation',
                  },
                ].map(item => (
                  <div key={item.key} className='space-y-2'>
                    <div className='text-sm font-medium'>{item.label}</div>
                    <div className='grid grid-cols-1 sm:grid-cols-5 gap-2'>
                      {IMPORTANCE.map((val, idx) => {
                        const color = IMPORTANCE_COLORS[idx];
                        const selected = answers.priorities[item.key] === val;
                        return (
                          <button
                            key={val}
                            onClick={() => setPriority(item.key, val)}
                            className={`px-3 py-2 rounded-md border text-sm ${selected ? 'text-white' : 'bg-white text-gray-800 border-gray-300'}`}
                            style={
                              selected
                                ? {
                                    backgroundColor: color,
                                    borderColor: color,
                                    borderWidth: 1,
                                  }
                                : undefined
                            }
                          >
                            {val}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className='flex gap-2'>
                <button
                  onClick={prev}
                  className='flex-1 border border-gray-300 rounded-lg py-3'
                >
                  Retour
                </button>
                <button
                  onClick={next}
                  className='flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg py-3'
                >
                  Suivant
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <ScaleScreen
              title='À quel point un système de points pour fidéliser vos clients vous intéresse ?'
              value={answers.q4_loyalty}
              onSelect={v => setAnswers((p: any) => ({ ...p, q4_loyalty: v }))}
              prev={prev}
              next={next}
            />
          )}
          {step === 5 && (
            <ScaleScreen
              title='Une IA qui amène automatiquement de nouveaux clients à vos lives :'
              value={answers.q5_ai_reco}
              onSelect={v => setAnswers((p: any) => ({ ...p, q5_ai_reco: v }))}
              prev={prev}
              next={next}
            />
          )}
          {step === 6 && (
            <ScaleScreen
              title='Souhaitez-vous que Paylive propose automatiquement des articles complémentaires à vos clients ?'
              value={answers.q6_crosssell}
              onSelect={v =>
                setAnswers((p: any) => ({ ...p, q6_crosssell: v }))
              }
              prev={prev}
              next={next}
            />
          )}
          {step === 7 && (
            <ScaleScreen
              title='L’automatisation des étiquettes / transporteurs serait :'
              value={answers.q7_logistics}
              onSelect={v =>
                setAnswers((p: any) => ({ ...p, q7_logistics: v }))
              }
              prev={prev}
              next={next}
            />
          )}
          {step === 8 && (
            <ScaleScreen
              title='Aimeriez-vous notifier automatiquement vos clients (panier abandonné, promo, live qui commence) ?'
              value={answers.q8_notifications}
              onSelect={v =>
                setAnswers((p: any) => ({ ...p, q8_notifications: v }))
              }
              prev={prev}
              next={next}
            />
          )}
          {step === 9 && (
            <ScaleScreen
              title='Un assistant qui envoie les liens de paiement + messages automatiquement pendant votre live ?'
              value={answers.q9_assistant}
              onSelect={v =>
                setAnswers((p: any) => ({ ...p, q9_assistant: v }))
              }
              prev={prev}
              next={next}
            />
          )}
          {step === 10 && (
            <ScaleScreen
              title='Avez-vous besoin d’un système qui génère automatiquement factures, TVA et exports comptables ?'
              value={answers.q10_compta}
              onSelect={v => setAnswers((p: any) => ({ ...p, q10_compta: v }))}
              prev={prev}
              next={next}
            />
          )}
          {step === 11 && (
            <ScaleScreen
              title='Avez-vous une équipe ? Le multi-admin vous serait utile ?'
              value={answers.q11_multiadmin}
              onSelect={v =>
                setAnswers((p: any) => ({ ...p, q11_multiadmin: v }))
              }
              prev={prev}
              next={next}
            />
          )}
          {step === 12 && (
            <ScaleScreen
              title='Aimeriez-vous une mini-boutique Paylive que vous pouvez personnaliser (comme un mini Shopify) ?'
              value={answers.q12_storepage}
              onSelect={v =>
                setAnswers((p: any) => ({ ...p, q12_storepage: v }))
              }
              prev={prev}
              next={next}
            />
          )}
          {step === 13 && (
            <ScaleScreen
              title='Une messagerie centralisée pour gérer vos clients :'
              value={answers.q13_messaging}
              onSelect={v =>
                setAnswers((p: any) => ({ ...p, q13_messaging: v }))
              }
              prev={prev}
              next={next}
            />
          )}
          {step === 14 && (
            <div className='space-y-6'>
              <div className='text-xl font-semibold'>
                Utilisez-vous OBS/Streamlabs pour vos lives ?
              </div>
              <div className='grid grid-cols-2 gap-3'>
                {['Oui', 'Non'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => {
                      setAnswers((p: any) => ({ ...p, q14_obs: opt }));
                      setTimeout(() => next(), 120);
                    }}
                    className={`w-full px-4 py-3 rounded-lg border ${answers.q14_obs === opt ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300'} transition`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className='flex gap-2'>
                <button
                  onClick={prev}
                  className='flex-1 border border-gray-300 rounded-lg py-3'
                >
                  Retour
                </button>
                <button
                  onClick={next}
                  className='flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg py-3'
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
          {step === 15 && (
            <ScaleScreen
              title='Une IA qui vous dit quand lancer un live, quels produits mettre en avant, quel prix, etc.'
              value={answers.q15_aicoach}
              onSelect={v => setAnswers((p: any) => ({ ...p, q15_aicoach: v }))}
              prev={prev}
              next={next}
            />
          )}
          {step === 16 && (
            <div className='space-y-6'>
              <div className='text-xl font-semibold'>
                Si vous ne deviez garder qu’UNE seule fonctionnalité parmi
                toutes, ce serait laquelle ?
              </div>
              <div className='grid grid-cols-1 gap-3'>
                {[
                  'Fidélité / Points',
                  'IA découverte (nouveaux clients)',
                  'Cross-sell automatique',
                  'Logistique intelligente',
                  'Assistant Live',
                  'Comptabilité automatique',
                  'Multi-admin',
                  'Boutique Paylive',
                  'Messagerie client',
                  'Intégration OBS',
                  'IA Coach',
                ].map(opt => (
                  <button
                    key={opt}
                    onClick={() => {
                      setAnswers((p: any) => ({ ...p, q16_top: opt }));
                      setTimeout(() => next(), 120);
                    }}
                    className={`w-full px-4 py-3 rounded-lg border ${answers.q16_top === opt ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300'} transition`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className='flex gap-2'>
                <button
                  onClick={prev}
                  className='flex-1 border border-gray-300 rounded-lg py-3'
                >
                  Retour
                </button>
                <button
                  onClick={next}
                  className='flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg py-3'
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
          {step === 17 && (
            <div className='space-y-6'>
              <div className='text-xl font-semibold'>
                Quel est votre plus gros blocage aujourd’hui pour vendre plus ou
                plus vite ?
              </div>
              <textarea
                value={answers.q17_problem}
                onChange={e =>
                  setAnswers((p: any) => ({
                    ...p,
                    q17_problem: e.target.value,
                  }))
                }
                className='w-full border border-gray-300 rounded-lg p-3 h-32'
                placeholder='Écrivez votre réponse'
              />
              <div className='flex gap-2'>
                <button
                  onClick={prev}
                  className='flex-1 border border-gray-300 rounded-lg py-3'
                >
                  Retour
                </button>
                <button
                  onClick={next}
                  className='flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg py-3'
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
          {step === 18 && (
            <div className='space-y-6'>
              <div className='text-xl font-semibold'>
                Si vous voulez qu’on vous invite pour tester en avant-première.
              </div>
              <input
                type='email'
                value={answers.q18_email}
                onChange={e =>
                  setAnswers((p: any) => ({ ...p, q18_email: e.target.value }))
                }
                className='w-full border border-gray-300 rounded-lg p-3'
                placeholder='Votre email'
              />
              {!answers.q18_email ||
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.q18_email) ? (
                <div className='text-xs text-red-600'>
                  Email obligatoire et valide
                </div>
              ) : null}
              <div className='flex gap-2'>
                <button
                  onClick={prev}
                  className='flex-1 border border-gray-300 rounded-lg py-3'
                >
                  Retour
                </button>
                <button
                  onClick={next}
                  className='flex-1  border border-gray-300  disabled:cursor-not-allowed disabled:bg-gray-300  rounded-lg py-3'
                  disabled={
                    !answers.q18_email ||
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.q18_email)
                  }
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
          {step === 19 && (
            <div className='space-y-4 text-center'>
              <div className='text-2xl font-bold'>Merci !</div>
              <div className='text-gray-600'>
                Vos réponses vont directement influencer l’évolution de Paylive.
              </div>
              {submitError ? (
                <div className='text-sm text-red-600'>{submitError}</div>
              ) : null}
              {!submitted ? (
                <button
                  onClick={finish}
                  disabled={submitting}
                  className='w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-3 rounded-lg font-semibold'
                >
                  {submitting ? 'Envoi…' : 'Terminer'}
                </button>
              ) : (
                <div className='text-sm text-green-700'>
                  Vos réponses ont été envoyées. Merci pour votre temps !
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScaleScreen({
  title,
  value,
  onSelect,
  prev,
  next,
}: {
  title: string;
  value: string;
  onSelect: (v: string) => void;
  prev: () => void;
  next: () => void;
}) {
  return (
    <div className='space-y-6'>
      <div className='text-xl font-semibold'>{title}</div>
      <div className='grid grid-cols-1 sm:grid-cols-5 gap-2'>
        {IMPORTANCE.map((val, idx) => {
          const color = IMPORTANCE_COLORS[idx];
          const selected = value === val;
          return (
            <button
              key={val}
              onClick={() => {
                onSelect(val);
                setTimeout(() => next(), 120);
              }}
              className={`px-3 py-2 rounded-md border text-sm ${selected ? 'text-white' : 'bg-white text-gray-800 border-gray-300'}`}
              style={
                selected
                  ? {
                      backgroundColor: color,
                      borderColor: color,
                      borderWidth: 1,
                    }
                  : undefined
              }
            >
              {val}
            </button>
          );
        })}
      </div>
      <div className='flex gap-2'>
        <button
          onClick={prev}
          className='flex-1 border border-gray-300 rounded-lg py-3'
        >
          Retour
        </button>
        <button
          onClick={next}
          className='flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg py-3'
        >
          Suivant
        </button>
      </div>
    </div>
  );
}
