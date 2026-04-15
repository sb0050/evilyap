import React, { useMemo, useState } from 'react';
import { useUser, SignedIn, SignedOut, RedirectToSignIn, UserButton } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';

type LeadStatus =
  | 'À contacter'
  | 'Contacté'
  | 'Répondu'
  | 'Interessé'
  | 'Call / Démo prévu'
  | 'En Onboarding'
  | 'Perdu / Refusé'
  | 'Actif';

type Lead = {
  id: string;
  name: string;
  store: string;
  phone: string;
  email: string;
  webLink: string;
  status: LeadStatus;
};

type LeadColumn = Readonly<{
  key: LeadStatus;
  colorClass: string;
  badgeClass: string;
}>;

// Structure fixe: colonnes non modifiables/supprimables/deplacables via l'UI.
const LEAD_COLUMNS: ReadonlyArray<LeadColumn> = Object.freeze([
  {
    key: 'À contacter',
    colorClass: 'bg-blue-600 text-white',
    badgeClass: 'bg-blue-100 text-blue-700',
  },
  {
    key: 'Contacté',
    colorClass: 'bg-orange-600 text-white',
    badgeClass: 'bg-orange-100 text-orange-700',
  },
  {
    key: 'Répondu',
    colorClass: 'bg-emerald-600 text-white',
    badgeClass: 'bg-emerald-100 text-emerald-700',
  },
  {
    key: 'Interessé',
    colorClass: 'bg-pink-600 text-white',
    badgeClass: 'bg-pink-100 text-pink-700',
  },
  {
    key: 'Call / Démo prévu',
    colorClass: 'bg-amber-500 text-gray-900',
    badgeClass: 'bg-amber-100 text-amber-800',
  },
  {
    key: 'En Onboarding',
    colorClass: 'bg-indigo-600 text-white',
    badgeClass: 'bg-indigo-100 text-indigo-700',
  },
  {
    key: 'Perdu / Refusé',
    colorClass: 'bg-red-600 text-white',
    badgeClass: 'bg-red-100 text-red-700',
  },
  {
    key: 'Actif',
    colorClass: 'bg-teal-600 text-white',
    badgeClass: 'bg-teal-100 text-teal-700',
  },
]);

export default function LeadsPage() {
  const { user } = useUser();
  const role = String(user?.publicMetadata?.role || '')
    .trim()
    .toLowerCase();
  const isAdmin = role === 'admin';
  const [leads, setLeads] = useState<Lead[]>([]);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [collapsedStatuses, setCollapsedStatuses] = useState<
    Record<LeadStatus, boolean>
  >(
    () =>
      LEAD_COLUMNS.reduce((acc, column) => {
        acc[column.key] = false;
        return acc;
      }, {} as Record<LeadStatus, boolean>)
  );
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadStore, setNewLeadStore] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadEmail, setNewLeadEmail] = useState('');
  const [newLeadWebLink, setNewLeadWebLink] = useState('');
  const [newLeadStatus, setNewLeadStatus] = useState<LeadStatus>('À contacter');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const leadsByStatus = useMemo(
    () =>
      LEAD_COLUMNS.reduce((acc, column) => {
        acc[column.key] = leads.filter(lead => lead.status === column.key);
        return acc;
      }, {} as Record<LeadStatus, Lead[]>),
    [leads]
  );

  const createLead = () => {
    const name = newLeadName.trim();
    const store = newLeadStore.trim();
    const phone = newLeadPhone.trim();
    const email = newLeadEmail.trim();
    const webLink = newLeadWebLink.trim();

    if (!name) return;

    const lead: Lead = {
      id: crypto.randomUUID(),
      name,
      store,
      phone,
      email,
      webLink,
      status: newLeadStatus,
    };

    setLeads(prev => [lead, ...prev]);
    setNewLeadName('');
    setNewLeadStore('');
    setNewLeadPhone('');
    setNewLeadEmail('');
    setNewLeadWebLink('');
    setNewLeadStatus('À contacter');
    setIsCreateModalOpen(false);
  };

  const moveLeadToStatus = (leadId: string, status: LeadStatus) => {
    setLeads(prev =>
      prev.map(lead => (lead.id === leadId ? { ...lead, status } : lead))
    );
  };

  const toggleColumn = (status: LeadStatus) => {
    setCollapsedStatuses(prev => ({ ...prev, [status]: !prev[status] }));
  };

  return (
    <div className='min-h-screen bg-gray-50'>
      <SignedIn>
        <div className='fixed top-4 right-4 z-50'>
          <UserButton />
        </div>

        {!isAdmin ? (
          <div className='max-w-2xl mx-auto px-4 py-10'>
            <div className='bg-white rounded-lg shadow p-6'>
              <h1 className='text-2xl font-bold text-gray-900'>Accès refusé</h1>
              <p className='text-gray-600 mt-2'>
                Cette page est réservée aux administrateurs.
              </p>
            </div>
          </div>
        ) : (
          <div className='max-w-6xl mx-auto px-4 py-10'>
            <div className='mb-6 flex items-start justify-between gap-4'>
              <div>
                <h1 className='text-2xl font-bold text-gray-900'>
                  Tableau de prospects
                </h1>
                <p className='text-gray-600'>
                  Suivi centralisé des prospects PayLive.
                </p>
              </div>
              <Link
                to='/admin'
                className='inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100'
              >
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  className='h-4 w-4'
                  aria-hidden='true'
                >
                  <path d='M15 18l-6-6 6-6' />
                </svg>
                Retour
              </Link>
            </div>

            <div className='mb-6 flex justify-end'>
              <button
                type='button'
                onClick={() => setIsCreateModalOpen(true)}
                className='inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700'
              >
                Créer une carte
              </button>
            </div>

            <div className='overflow-x-auto pb-2'>
              <div className='inline-flex min-w-max gap-4'>
                {LEAD_COLUMNS.map(column => {
                  const leads = leadsByStatus[column.key];
                  const isCollapsed = collapsedStatuses[column.key];
                  return (
                    <section
                      key={column.key}
                      className={`bg-white border border-gray-200 rounded-lg min-h-[760px] transition-all ${
                        isCollapsed ? 'w-[86px]' : 'w-[320px]'
                      }`}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => {
                        if (!draggedLeadId) return;
                        moveLeadToStatus(draggedLeadId, column.key);
                        setDraggedLeadId(null);
                      }}
                    >
                      <header className='px-3 py-3 border-b border-gray-200'>
                        {isCollapsed ? (
                          <div className='flex flex-col items-center gap-3'>
                            <button
                              type='button'
                              onClick={() => toggleColumn(column.key)}
                              className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100'
                              aria-label={`Déplier ${column.key}`}
                            >
                              <svg
                                xmlns='http://www.w3.org/2000/svg'
                                viewBox='0 0 24 24'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth='2'
                                className='h-4 w-4'
                                aria-hidden='true'
                              >
                                <path d='M9 6l6 6-6 6' />
                              </svg>
                            </button>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-2 text-xs font-semibold ${column.colorClass} [writing-mode:vertical-rl] [text-orientation:mixed]`}
                            >
                              {column.key}
                            </span>
                            <span
                              className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold ${column.badgeClass}`}
                            >
                              {leads.length}
                            </span>
                          </div>
                        ) : (
                          <div className='flex items-center justify-between gap-2'>
                            <div className='flex items-center gap-2 min-w-0'>
                              <button
                                type='button'
                                onClick={() => toggleColumn(column.key)}
                                className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100'
                                aria-label={`Replier ${column.key}`}
                              >
                                <svg
                                  xmlns='http://www.w3.org/2000/svg'
                                  viewBox='0 0 24 24'
                                  fill='none'
                                  stroke='currentColor'
                                  strokeWidth='2'
                                  className='h-4 w-4'
                                  aria-hidden='true'
                                >
                                  <path d='M9 6l6 6-6 6' />
                                </svg>
                              </button>
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${column.colorClass}`}
                              >
                                <span className='truncate'>{column.key}</span>
                              </span>
                            </div>
                            <span
                              className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold ${column.badgeClass}`}
                            >
                              {leads.length}
                            </span>
                          </div>
                        )}
                      </header>

                      {isCollapsed ? (
                        <div className='min-h-[700px] bg-gray-50/60' />
                      ) : (
                        <div className='p-3 space-y-3 min-h-[700px] bg-gray-50/60'>
                          {leads.length === 0 ? (
                            <div className='h-full rounded-md border border-dashed border-gray-300 bg-white/70 p-3 text-xs text-gray-400'>
                              Aucun prospect
                            </div>
                          ) : (
                            leads.map(lead => (
                              <article
                                key={lead.id}
                                draggable
                                onDragStart={() => setDraggedLeadId(lead.id)}
                                onDragEnd={() => setDraggedLeadId(null)}
                                className='cursor-grab rounded-md border border-gray-200 bg-white p-3 shadow-sm active:cursor-grabbing'
                              >
                                <p className='text-sm font-semibold text-gray-900'>
                                  {lead.name}
                                </p>
                              {lead.store ? (
                                <p className='mt-1 text-xs font-medium text-gray-700'>
                                  Boutique: {lead.store}
                                </p>
                              ) : null}
                                {lead.phone ? (
                                  <p className='mt-1 text-xs text-gray-600'>
                                    Tel: {lead.phone}
                                  </p>
                                ) : null}
                                {lead.email ? (
                                  <p className='text-xs text-gray-600 break-all'>
                                    E-mail: {lead.email}
                                  </p>
                                ) : null}
                              {lead.webLink ? (
                                <a
                                  href={lead.webLink}
                                  target='_blank'
                                  rel='noreferrer'
                                  className='mt-1 block text-xs text-indigo-600 hover:underline break-all'
                                >
                                  Lien web: {lead.webLink}
                                </a>
                              ) : null}
                              </article>
                            ))
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>

            {isCreateModalOpen ? (
              <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
                <div className='w-full max-w-2xl rounded-xl bg-white shadow-xl'>
                  <div className='flex items-center justify-between border-b border-gray-200 px-5 py-4'>
                    <h2 className='text-lg font-semibold text-gray-900'>
                      Nouvelle carte prospect
                    </h2>
                    <button
                      type='button'
                      onClick={() => setIsCreateModalOpen(false)}
                      className='inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100'
                      aria-label='Fermer'
                    >
                      ✕
                    </button>
                  </div>

                  <div className='p-5'>
                    <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                      <input
                        type='text'
                        value={newLeadName}
                        onChange={e => setNewLeadName(e.target.value)}
                        placeholder='Nom du prospect'
                        className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'
                      />
                      <input
                        type='text'
                        value={newLeadStore}
                        onChange={e => setNewLeadStore(e.target.value)}
                        placeholder='Boutique'
                        className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'
                      />
                      <input
                        type='text'
                        value={newLeadPhone}
                        onChange={e => setNewLeadPhone(e.target.value)}
                        placeholder='Téléphone'
                        className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'
                      />
                      <input
                        type='email'
                        value={newLeadEmail}
                        onChange={e => setNewLeadEmail(e.target.value)}
                        placeholder='E-mail'
                        className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'
                      />
                      <input
                        type='url'
                        value={newLeadWebLink}
                        onChange={e => setNewLeadWebLink(e.target.value)}
                        placeholder='Lien web'
                        className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm md:col-span-2'
                      />
                    </div>
                  </div>

                  <div className='flex justify-end gap-2 border-t border-gray-200 px-5 py-4'>
                    <button
                      type='button'
                      onClick={() => setIsCreateModalOpen(false)}
                      className='inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100'
                    >
                      Annuler
                    </button>
                    <button
                      type='button'
                      onClick={createLead}
                      disabled={!newLeadName.trim()}
                      className='inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      Créer la carte
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </div>
  );
}
