import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useUser,
  useAuth,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  UserButton,
} from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import LinkExtension from '@tiptap/extension-link';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { apiDelete, apiGet, apiPost, apiPut } from '../../utils/api';

type LeadStatus =
  | 'A contacter'
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
  quickNote: string;
  note: string;
  imageUrls: string[];
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
    key: 'A contacter',
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

const STATUS_LABEL_TO_ID: Record<LeadStatus, number> = {
  'A contacter': 1,
  'Contacté': 2,
  'Répondu': 3,
  'Interessé': 4,
  'Call / Démo prévu': 5,
  'En Onboarding': 6,
  'Perdu / Refusé': 7,
  'Actif': 8,
};

const STATUS_ID_TO_LABEL: Record<number, LeadStatus> = {
  1: 'A contacter',
  2: 'Contacté',
  3: 'Répondu',
  4: 'Interessé',
  5: 'Call / Démo prévu',
  6: 'En Onboarding',
  7: 'Perdu / Refusé',
  8: 'Actif',
};

const isLeadStatusLabel = (value: string): value is LeadStatus =>
  LEAD_COLUMNS.some(column => column.key === value);

const normalizeLeadStatus = (raw: unknown): LeadStatus => {
  const value = String(raw ?? '')
    .trim()
    .replace('ContactÃ©', 'Contacté')
    .replace('RÃ©pondu', 'Répondu')
    .replace('InteressÃ©', 'Interessé')
    .replace('Call / DÃ©mo prÃ©vu', 'Call / Démo prévu')
    .replace('Perdu / RefusÃ©', 'Perdu / Refusé');
  if (!value) return 'A contacter';

  if (isLeadStatusLabel(value)) {
    return value;
  }

  const asNumber = Number(value);
  if (
    Number.isInteger(asNumber) &&
    asNumber >= 1 &&
    asNumber <= 8 &&
    STATUS_ID_TO_LABEL[asNumber]
  ) {
    return STATUS_ID_TO_LABEL[asNumber];
  }

  return 'A contacter';
};

const columnDropId = (status: LeadStatus) => `column:${status}`;

const extractApiErrorMessage = (error: unknown, fallback: string): string => {
  const rawMessage = String((error as any)?.message || '').trim();
  if (!rawMessage) return fallback;
  const withoutPrefix = rawMessage.startsWith('Error: ')
    ? rawMessage.slice('Error: '.length).trim()
    : rawMessage;
  try {
    const parsed = JSON.parse(withoutPrefix);
    const apiError = String(parsed?.error || '').trim();
    return apiError || fallback;
  } catch {
    return withoutPrefix || fallback;
  }
};

const normalizeStoreForCompare = (raw: string): string =>
  String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const normalizeSearchText = (raw: string): string =>
  String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const isValidEmailFormat = (raw: string): boolean => {
  const value = String(raw || '').trim();
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const isValidWebLinkFormat = (raw: string): boolean => {
  const value = String(raw || '').trim();
  if (!value) return true;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    return Boolean(url.hostname);
  } catch {
    return false;
  }
};

const toBrowserUrl = (raw: string): string => {
  const value = String(raw || '').trim();
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
};

const normalizeImageUrls = (raw: unknown): string[] => {
  const source = String(raw || '');
  if (!source.trim()) return [];
  const unique = new Set<string>();
  source
    .split(';')
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .forEach(url => unique.add(url));
  return Array.from(unique);
};

const joinImageUrlsForStorage = (urls: string[]): string =>
  Array.from(
    new Set((urls || []).map(item => String(item || '').trim()).filter(Boolean))
  ).join(';');

const getImageAttachmentLabel = (url: string): string => {
  try {
    const parsed = new URL(url);
    const pathName = decodeURIComponent(parsed.pathname || '');
    const parts = pathName.split('/').filter(Boolean);
    return parts[parts.length - 1] || parsed.hostname || url;
  } catch {
    return url;
  }
};

const formatAttachmentAddedAt = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const mapApiLeadToLead = (row: any): Lead => ({
  id: String(row?.id || crypto.randomUUID()),
  name: String(row?.name || '').trim(),
  store: String(row?.store || '').trim(),
  phone: String(row?.phone || '').trim(),
  email: String(row?.mail || row?.email || '').trim(),
  webLink: String(row?.link || row?.web_link || row?.webLink || '').trim(),
  quickNote: String(row?.quick_note || row?.quickNote || '').trim(),
  note: String(row?.note || '').trim(),
  imageUrls: normalizeImageUrls(row?.image_url || row?.imageUrl),
  status: normalizeLeadStatus(
    row?.status_text ||
      row?.status_label ||
      row?.lead_status ||
      row?.statut ||
      row?.status
  ),
});

type LeadCardProps = {
  lead: Lead;
  onSaveQuickNote: (leadId: string, quickNote: string) => void;
  onOpenLead: (leadId: string) => void;
};

function LeadCard({ lead, onSaveQuickNote, onOpenLead }: LeadCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: lead.id,
      data: { leadId: lead.id },
    });
  const [isQuickNoteEditing, setIsQuickNoteEditing] = useState(false);
  const [quickNoteDraft, setQuickNoteDraft] = useState(lead.quickNote);
  const draggedRef = useRef(false);

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.55 : 1,
  };

  useEffect(() => {
    if (isDragging) {
      draggedRef.current = true;
    }
  }, [isDragging]);

  const startQuickNoteEdit = () => {
    setQuickNoteDraft(lead.quickNote);
    setIsQuickNoteEditing(true);
  };

  const cancelQuickNoteEdit = () => {
    setQuickNoteDraft(lead.quickNote);
    setIsQuickNoteEditing(false);
  };

  const submitQuickNoteEdit = () => {
    onSaveQuickNote(lead.id, quickNoteDraft.trim());
    setIsQuickNoteEditing(false);
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className='relative cursor-grab rounded-md border border-gray-200 bg-white p-3 pr-11 shadow-sm active:cursor-grabbing'
      onClick={() => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        onOpenLead(lead.id);
      }}
    >
      <button
        type='button'
        onClick={e => {
          e.stopPropagation();
          onOpenLead(lead.id);
        }}
        onPointerDown={e => e.stopPropagation()}
        className='absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-indigo-700'
        aria-label='Modifier le prospect'
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
          <path d='M12 20h9' />
          <path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' />
        </svg>
      </button>
      <p className='text-sm font-semibold text-gray-900'>{lead.name}</p>
      {lead.store ? (
        <p className='mt-1 text-xs font-medium text-gray-700'>
          Boutique: {lead.store}
        </p>
      ) : null}
      {lead.phone ? (
        <p className='mt-1 text-xs text-gray-600'>Tel: {lead.phone}</p>
      ) : null}
      {lead.email ? (
        <p className='text-xs text-gray-600 break-all'>E-mail: {lead.email}</p>
      ) : null}
      {lead.webLink ? (
        <a
          href={toBrowserUrl(lead.webLink)}
          target='_blank'
          rel='noreferrer'
          className='mt-1 block text-xs text-indigo-600 hover:underline break-all'
        >
          Lien web
        </a>
      ) : null}
      <div
        className='mt-2 border-t border-gray-100 pt-2'
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        {(lead.quickNote || isQuickNoteEditing) && (
          <div className='mb-2 flex items-center justify-between gap-2'>
            <p className='text-xs font-semibold uppercase tracking-wide text-gray-500'>
              Note Rapide
            </p>
            {lead.quickNote ? (
              <div className='ml-auto flex items-center gap-1'>
                <button
                  type='button'
                  onClick={startQuickNoteEdit}
                  className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700'
                  aria-label='Modifier la Note Rapide'
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
                    <path d='M12 20h9' />
                    <path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' />
                  </svg>
                </button>
                <button
                  type='button'
                  onClick={() => onSaveQuickNote(lead.id, '')}
                  className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-300 text-red-700 hover:bg-red-50'
                  aria-label='Supprimer la Note Rapide'
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
                    <path d='M18 6 6 18' />
                    <path d='m6 6 12 12' />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>
        )}
        {lead.quickNote ? (
          <p className='mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800'>
            {lead.quickNote}
          </p>
        ) : null}
        {isQuickNoteEditing ? (
          <div className='flex items-center gap-1'>
            <input
              type='text'
              value={quickNoteDraft}
              onChange={e => setQuickNoteDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submitQuickNoteEdit();
                if (e.key === 'Escape') cancelQuickNoteEdit();
              }}
              placeholder='Note Rapide...'
              className='w-full rounded-md border border-gray-300 px-2 py-1 text-xs'
            />
            <button
              type='button'
              onClick={submitQuickNoteEdit}
              className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-50'
              aria-label='Valider la Note Rapide'
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
                <path d='m20 6-11 11-5-5' />
              </svg>
            </button>
            <button
              type='button'
              onClick={cancelQuickNoteEdit}
              className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-300 text-red-700 hover:bg-red-50'
              aria-label='Annuler la Note Rapide'
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
                <path d='M18 6 6 18' />
                <path d='m6 6 12 12' />
              </svg>
            </button>
          </div>
        ) : !lead.quickNote ? (
          <button
            type='button'
            onClick={startQuickNoteEdit}
            className='inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700'
            aria-label='Ajouter une Note Rapide'
          >
            + Ajouter une Note Rapide
          </button>
        ) : null}
      </div>
    </article>
  );
}

type LeadColumnProps = {
  column: LeadColumn;
  leads: Lead[];
  isCollapsed: boolean;
  onToggle: (status: LeadStatus) => void;
  onSaveQuickNote: (leadId: string, quickNote: string) => void;
  onOpenLead: (leadId: string) => void;
};

function LeadColumnLane({
  column,
  leads,
  isCollapsed,
  onToggle,
  onSaveQuickNote,
  onOpenLead,
}: LeadColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnDropId(column.key),
  });

  return (
    <section
      ref={setNodeRef}
      className={`bg-white border rounded-lg min-h-[760px] transition-all ${
        isCollapsed ? 'w-[86px]' : 'w-[360px]'
      } ${isOver ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-gray-200'}`}
    >
      <header className='px-3 py-3 border-b border-gray-200'>
        {isCollapsed ? (
          <div className='flex flex-col items-center gap-3'>
            <button
              type='button'
              onClick={() => onToggle(column.key)}
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
                onClick={() => onToggle(column.key)}
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
              <LeadCard
                key={lead.id}
                lead={lead}
                onSaveQuickNote={onSaveQuickNote}
                onOpenLead={onOpenLead}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

type LeadDetailsModalProps = {
  lead: Lead;
  onClose: () => void;
  onUpdateLead: (
    leadId: string,
    updates: Partial<
      Pick<
        Lead,
        | 'name'
        | 'store'
        | 'phone'
        | 'email'
        | 'webLink'
        | 'quickNote'
        | 'note'
        | 'imageUrls'
      >
    >
  ) => Promise<void>;
  onDeleteLead: (leadId: string) => Promise<void>;
};

function LeadDetailsModal({
  lead,
  onClose,
  onUpdateLead,
  onDeleteLead,
}: LeadDetailsModalProps) {
  const initialLeadRef = useRef(lead);
  const [localLead, setLocalLead] = useState<Lead>(lead);
  const [editingField, setEditingField] = useState<
    'name' | 'store' | 'phone' | 'email' | 'webLink' | 'quickNote' | null
  >(null);
  const [draftValue, setDraftValue] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSavingField, setIsSavingField] = useState(false);
  const [richTextDraft, setRichTextDraft] = useState(lead.note || '<p></p>');
  const [isRichTextDirty, setIsRichTextDirty] = useState(false);
  const [isSavingRichText, setIsSavingRichText] = useState(false);
  const [isDeletingLead, setIsDeletingLead] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('https://');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [imageUrlDraft, setImageUrlDraft] = useState('');
  const [imageAddedAtByUrl, setImageAddedAtByUrl] = useState<
    Record<string, string>
  >({});

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Highlight,
      LinkExtension.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
      }),
    ],
    content: lead.note || '<p></p>',
    onUpdate: ({ editor: currentEditor }) => {
      setRichTextDraft(currentEditor.getHTML());
      setIsRichTextDirty(true);
    },
  });

  useEffect(() => {
    initialLeadRef.current = lead;
    setLocalLead(lead);
    setEditingField(null);
    setDraftValue('');
    setSaveError(null);
    const nextContent = lead.note || '<p></p>';
    setRichTextDraft(nextContent);
    setIsRichTextDirty(false);
    setImageUrlDraft('');
    setImageAddedAtByUrl({});
  }, [
    lead.id,
    lead.name,
    lead.store,
    lead.phone,
    lead.email,
    lead.webLink,
    lead.quickNote,
    lead.note,
    lead.imageUrls,
  ]);

  useEffect(() => {
    setImageAddedAtByUrl(prev => {
      const existingUrls = new Set(localLead.imageUrls || []);
      let changed = false;
      const next: Record<string, string> = {};

      Object.entries(prev).forEach(([url, addedAt]) => {
        if (existingUrls.has(url)) next[url] = addedAt;
        else changed = true;
      });

      (localLead.imageUrls || []).forEach(url => {
        if (!next[url]) {
          next[url] = new Date().toISOString();
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [localLead.imageUrls]);

  useEffect(() => {
    if (!editor) return;
    const nextContent = lead.note || '<p></p>';
    if (editor.getHTML() !== nextContent) {
      editor.commands.setContent(nextContent);
    }
  }, [editor, lead.id, lead.note]);

  const startEditing = (
    field: 'name' | 'store' | 'phone' | 'email' | 'webLink' | 'quickNote',
    value: string
  ) => {
    setEditingField(field);
    setDraftValue(value);
    setSaveError(null);
  };

  const cancelEditing = () => {
    setEditingField(null);
    setDraftValue('');
    setSaveError(null);
  };

  const validateFieldDraft = (
    field: 'name' | 'store' | 'phone' | 'email' | 'webLink' | 'quickNote',
    value: string
  ): string | null => {
    const nextValue = value.trim();
    if ((field === 'name' || field === 'store') && !nextValue) {
      return field === 'name'
        ? 'Le nom du prospect est obligatoire.'
        : 'Le nom de la boutique est obligatoire.';
    }
    if (field === 'phone' && nextValue && !isValidPhoneNumber(nextValue)) {
      return 'Le numéro de téléphone est invalide.';
    }
    if (field === 'email' && !isValidEmailFormat(nextValue)) {
      return "L'adresse e-mail est invalide.";
    }
    if (field === 'webLink' && !isValidWebLinkFormat(nextValue)) {
      return 'Le lien web est invalide.';
    }
    return null;
  };

  const saveField = (
    field: 'name' | 'store' | 'phone' | 'email' | 'webLink' | 'quickNote'
  ) => {
    const nextValue = draftValue.trim();
    const validationError = validateFieldDraft(field, nextValue);
    if (validationError) {
      setSaveError(validationError);
      return;
    }

    setSaveError(null);
    setLocalLead(prev => ({ ...prev, [field]: nextValue }));
    setEditingField(null);
    setDraftValue('');
  };

  const addImageUrl = () => {
    const nextValue = imageUrlDraft.trim();
    if (!nextValue) return;
    if (!isValidWebLinkFormat(nextValue)) {
      setSaveError('Lien image invalide.');
      return;
    }
    setSaveError(null);
    setLocalLead(prev => {
      const existing = new Set((prev.imageUrls || []).map(url => url.trim()));
      existing.add(nextValue);
      return { ...prev, imageUrls: Array.from(existing) };
    });
    setImageAddedAtByUrl(prev => ({
      ...prev,
      [nextValue]: new Date().toISOString(),
    }));
    setImageUrlDraft('');
  };
  const trimmedImageUrlDraft = imageUrlDraft.trim();
  const isImageUrlDraftInvalid =
    Boolean(trimmedImageUrlDraft) && !isValidWebLinkFormat(trimmedImageUrlDraft);
  const hasInvalidExistingLeadFields =
    (localLead.phone.trim() && !isValidPhoneNumber(localLead.phone)) ||
    !isValidEmailFormat(localLead.email) ||
    !isValidWebLinkFormat(localLead.webLink);
  const activeFieldValidationError = editingField
    ? validateFieldDraft(editingField, draftValue)
    : null;
  const isModalValidateDisabled =
    isSavingRichText ||
    isSavingField ||
    Boolean(activeFieldValidationError) ||
    isImageUrlDraftInvalid ||
    hasInvalidExistingLeadFields;

  const removeImageUrl = (urlToRemove: string) => {
    const target = String(urlToRemove || '').trim();
    setLocalLead(prev => ({
      ...prev,
      imageUrls: (prev.imageUrls || []).filter(url => url.trim() !== target),
    }));
    setImageAddedAtByUrl(prev => {
      const next = { ...prev };
      delete next[target];
      return next;
    });
  };

  const cancelRichText = (targetNote?: string) => {
    const nextContent = (targetNote ?? localLead.note) || '<p></p>';
    setRichTextDraft(nextContent);
    setIsRichTextDirty(false);
    setSaveError(null);
    if (!editor) return;
    if (editor.getHTML() !== nextContent) {
      editor.commands.setContent(nextContent);
    }
  };

  const handleValidateAndClose = async () => {
    const activeField = editingField;
    if (activeField) {
      const validationError = validateFieldDraft(activeField, draftValue);
      if (validationError) {
        setSaveError(validationError);
        return;
      }
    }
    const finalLead: Lead = {
      ...localLead,
      ...(activeField ? { [activeField]: draftValue.trim() } : {}),
      note: richTextDraft.trim(),
    };
    const initialLead = initialLeadRef.current;
    const updates: Partial<
      Pick<
        Lead,
        | 'name'
        | 'store'
        | 'phone'
        | 'email'
        | 'webLink'
        | 'quickNote'
        | 'note'
        | 'imageUrls'
      >
    > = {};
    if (finalLead.name !== initialLead.name) updates.name = finalLead.name;
    if (finalLead.store !== initialLead.store) updates.store = finalLead.store;
    if (finalLead.phone !== initialLead.phone) updates.phone = finalLead.phone;
    if (finalLead.email !== initialLead.email) updates.email = finalLead.email;
    if (finalLead.webLink !== initialLead.webLink)
      updates.webLink = finalLead.webLink;
    if (finalLead.quickNote !== initialLead.quickNote) {
      updates.quickNote = finalLead.quickNote;
    }
    if (finalLead.note !== initialLead.note) updates.note = finalLead.note;
    if (
      joinImageUrlsForStorage(finalLead.imageUrls) !==
      joinImageUrlsForStorage(initialLead.imageUrls)
    ) {
      updates.imageUrls = finalLead.imageUrls;
    }

    try {
      setIsSavingField(true);
      setIsSavingRichText(true);
      setSaveError(null);
      if (Object.keys(updates).length > 0) {
        await onUpdateLead(lead.id, updates);
      }
      setIsRichTextDirty(false);
      onClose();
    } catch (e: any) {
      setSaveError(e?.message || 'Erreur lors de la mise à jour');
    } finally {
      setIsSavingField(false);
      setIsSavingRichText(false);
    }
  };

  const handleCancelAndClose = () => {
    setLocalLead(initialLeadRef.current);
    cancelRichText(initialLeadRef.current.note || '<p></p>');
    setEditingField(null);
    setDraftValue('');
    onClose();
  };

  const deleteLead = async () => {
    try {
      setIsDeletingLead(true);
      setSaveError(null);
      await onDeleteLead(lead.id);
      setIsDeleteConfirmOpen(false);
      onClose();
    } catch (e: any) {
      setSaveError(e?.message || 'Erreur lors de la suppression');
    } finally {
      setIsDeletingLead(false);
    }
  };

  const renderEditableField = (
    label: string,
    field: 'name' | 'store' | 'phone' | 'email' | 'webLink' | 'quickNote',
    value: string,
    inputType: 'text' | 'email' | 'url' = 'text',
    wrapperClass = ''
  ) => (
    <div className={wrapperClass}>
      <div className='flex items-start gap-2'>
        {editingField === field ? null : (
          <button
            type='button'
            onClick={() => startEditing(field, value)}
            className='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100'
            aria-label={`Modifier ${label}`}
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
              <path d='M12 20h9' />
              <path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' />
            </svg>
          </button>
        )}
        <p>
          <span className='font-semibold'>{label}:</span>{' '}
          {!editingField || editingField !== field ? value || '-' : null}
        </p>
      </div>
      {editingField === field ? (
        <div className='mt-2 flex items-center gap-1'>
          {field === 'phone' ? (
            <PhoneInput
              international
              defaultCountry='FR'
              value={draftValue}
              onChange={value => setDraftValue(value || '')}
              placeholder='Téléphone'
              className={`w-full rounded-md border px-2 py-1 text-xs ${
                draftValue.trim() && !isValidPhoneNumber(draftValue)
                  ? 'border-red-400'
                  : 'border-gray-300'
              }`}
            />
          ) : (
            <input
              type={inputType}
              value={draftValue}
              onChange={e => setDraftValue(e.target.value)}
              className={`w-full rounded-md border px-2 py-1 text-xs ${
                validateFieldDraft(field, draftValue)
                  ? 'border-red-400'
                  : 'border-gray-300'
              }`}
            />
          )}
          <button
            type='button'
            onClick={() => void saveField(field)}
            disabled={isSavingField || Boolean(validateFieldDraft(field, draftValue))}
            className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50'
            aria-label={`Valider ${label}`}
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
              <path d='m20 6-11 11-5-5' />
            </svg>
          </button>
          <button
            type='button'
            onClick={cancelEditing}
            disabled={isSavingField}
            className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50'
            aria-label={`Annuler ${label}`}
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
              <path d='M18 6 6 18' />
              <path d='m6 6 12 12' />
            </svg>
          </button>
        </div>
      ) : null}
      {editingField === field &&
      field === 'phone' &&
      draftValue.trim() &&
      !isValidPhoneNumber(draftValue) ? (
        <p className='mt-1 text-xs text-red-600'>
          Numéro de téléphone invalide.
        </p>
      ) : null}
      {editingField === field &&
      field === 'email' &&
      draftValue.trim() &&
      !isValidEmailFormat(draftValue) ? (
        <p className='mt-1 text-xs text-red-600'>Adresse e-mail invalide.</p>
      ) : null}
      {editingField === field &&
      field === 'webLink' &&
      draftValue.trim() &&
      !isValidWebLinkFormat(draftValue) ? (
        <p className='mt-1 text-xs text-red-600'>
          Lien web invalide (http:// ou https://).
        </p>
      ) : null}
    </div>
  );

  const toolbarButtonClass =
    'inline-flex items-center rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100';

  const openLinkModalForEditor = () => {
    const currentHref = String(
      editor?.getAttributes('link')?.href || ''
    ).trim();
    setLinkDraft(currentHref || 'https://');
    setLinkError(null);
    setIsLinkModalOpen(true);
  };

  const submitLinkOnEditor = () => {
    const normalizedUrl = linkDraft.trim();
    if (!normalizedUrl) {
      editor?.chain().focus().unsetLink().run();
      setIsLinkModalOpen(false);
      setLinkError(null);
      return;
    }
    if (!isValidWebLinkFormat(normalizedUrl)) {
      setLinkError(
        'Lien invalide. Utilisez un lien commençant par http:// ou https://'
      );
      return;
    }
    setSaveError(null);
    setLinkError(null);
    editor
      ?.chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: normalizedUrl })
      .run();
    setIsLinkModalOpen(false);
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
      <div
        className='w-full max-w-3xl rounded-xl bg-white shadow-xl'
        onClick={e => e.stopPropagation()}
      >
        <div className='flex items-center justify-between border-b border-gray-200 px-5 py-4'>
          <h2 className='text-lg font-semibold text-gray-900'>
            Détails du client
          </h2>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setIsDeleteConfirmOpen(true)}
              disabled={isDeletingLead}
              className='inline-flex items-center rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50'
            >
              Supprimer
            </button>
          </div>
        </div>

        <div className='p-5'>
          {saveError ? (
            <div className='mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'>
              {saveError}
            </div>
          ) : null}
          <div className='grid grid-cols-1 gap-2 text-sm text-gray-700 md:grid-cols-2'>
            {renderEditableField('Nom', 'name', localLead.name)}
            {renderEditableField('Boutique', 'store', localLead.store)}
            {renderEditableField('Téléphone', 'phone', localLead.phone)}
            {renderEditableField('E-mail', 'email', localLead.email, 'email')}
            {renderEditableField(
              'Lien web',
              'webLink',
              localLead.webLink,
              'url'
            )}
            {renderEditableField(
              'Note Rapide',
              'quickNote',
              localLead.quickNote,
              'text'
            )}
          </div>

          <div className='mt-5'>
            <p className='mb-2 text-sm font-semibold text-gray-900'>
              Zone de texte enrichie
            </p>
            <div className='mb-2 flex flex-wrap gap-2'>
              <button
                type='button'
                onClick={() => editor?.chain().focus().toggleBold().run()}
                className={`${toolbarButtonClass} ${
                  editor?.isActive('bold') ? 'bg-gray-200' : ''
                }`}
              >
                Gras
              </button>
              <button
                type='button'
                onClick={() => editor?.chain().focus().toggleItalic().run()}
                className={`${toolbarButtonClass} ${
                  editor?.isActive('italic') ? 'bg-gray-200' : ''
                }`}
              >
                Italique
              </button>
              <button
                type='button'
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
                className={`${toolbarButtonClass} ${
                  editor?.isActive('underline') ? 'bg-gray-200' : ''
                }`}
              >
                Souligné
              </button>
              <button
                type='button'
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                className={`${toolbarButtonClass} ${
                  editor?.isActive('bulletList') ? 'bg-gray-200' : ''
                }`}
              >
                Puces
              </button>
              <button
                type='button'
                onClick={() => editor?.chain().focus().toggleHighlight().run()}
                className={`${toolbarButtonClass} ${
                  editor?.isActive('highlight') ? 'bg-yellow-200' : ''
                }`}
              >
                Surligner jaune
              </button>
              <button
                type='button'
                onClick={openLinkModalForEditor}
                className={`${toolbarButtonClass} ${
                  editor?.isActive('link') ? 'bg-blue-100 text-blue-700' : ''
                }`}
              >
                Lien
              </button>
            </div>
            <div className='rounded-lg border border-gray-300 bg-white p-3'>
              <EditorContent
                editor={editor}
                className='tiptap-content min-h-[180px] text-sm [&_.ProseMirror]:min-h-[160px] [&_.ProseMirror]:outline-none'
              />
            </div>
            <div className='mt-4'>
              <div className='mb-2 flex items-center gap-2'>
                <p className='text-sm font-semibold text-gray-900'>
                  Pieces jointes
                </p>
                <span className='inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-gray-100 px-2 text-xs font-semibold text-gray-700'>
                  {localLead.imageUrls.length}
                </span>
              </div>
              <div className='flex items-center gap-2'>
                <input
                  type='url'
                  value={imageUrlDraft}
                  onChange={e => setImageUrlDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addImageUrl();
                    }
                  }}
                  placeholder='https://...'
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-700 ${
                    isImageUrlDraftInvalid ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                <button
                  type='button'
                  onClick={addImageUrl}
                  className='inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100'
                >
                  Ajouter
                </button>
              </div>
              {localLead.imageUrls.length > 0 ? (
                <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'>
                  {localLead.imageUrls.map(url => (
                    <div
                      key={url}
                      className='overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm'
                    >
                      <a
                        href={toBrowserUrl(url)}
                        target='_blank'
                        rel='noreferrer'
                        className='block group'
                      >
                        <img
                          src={url}
                          alt={getImageAttachmentLabel(url)}
                          className='h-32 w-full object-cover bg-gray-50'
                        />
                        <div className='px-3 py-2 text-sm text-gray-800'>
                          <p className='truncate font-medium'>
                            {getImageAttachmentLabel(url)}
                          </p>
                          <p className='truncate text-xs text-indigo-600 group-hover:underline'>
                            {url}
                          </p>
                        </div>
                      </a>
                      <div className='border-t border-gray-100 px-3 py-2'>
                        <button
                          type='button'
                          onClick={() => removeImageUrl(url)}
                          className='inline-flex items-center rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50'
                        >
                          Retirer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className='mt-2 flex items-center justify-end gap-2'>
              <button
                type='button'
                onClick={handleCancelAndClose}
                disabled={isSavingRichText}
                className='inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50'
              >
                Annuler
              </button>
              <button
                type='button'
                onClick={() => void handleValidateAndClose()}
                disabled={isModalValidateDisabled}
                className='inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      </div>
      {isDeleteConfirmOpen ? (
        <div
          className='fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4'
          onClick={e => {
            e.stopPropagation();
            if (isDeletingLead) return;
            setIsDeleteConfirmOpen(false);
          }}
        >
          <div
            className='w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl'
            onClick={e => e.stopPropagation()}
          >
            <div className='border-b border-gray-200 px-5 py-4'>
              <h3 className='text-base font-semibold text-gray-900'>
                Confirmer la suppression
              </h3>
            </div>
            <div className='px-5 py-4 text-sm text-gray-700'>
              Voulez-vous vraiment supprimer ce client ? Cette action est
              irreversible.
            </div>
            <div className='flex justify-end gap-2 border-t border-gray-200 px-5 py-4'>
              <button
                type='button'
                onClick={() => setIsDeleteConfirmOpen(false)}
                disabled={isDeletingLead}
                className='inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50'
              >
                Annuler
              </button>
              <button
                type='button'
                onClick={() => void deleteLead()}
                disabled={isDeletingLead}
                className='inline-flex items-center rounded-lg border border-red-300 bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {isDeletingLead ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isLinkModalOpen ? (
        <div
          className='fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4'
          onClick={e => {
            e.stopPropagation();
            setIsLinkModalOpen(false);
            setLinkError(null);
          }}
        >
          <div
            className='w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl'
            onClick={e => e.stopPropagation()}
          >
            <div className='border-b border-gray-200 px-5 py-4'>
              <h3 className='text-base font-semibold text-gray-900'>
                Ajouter un lien
              </h3>
            </div>
            <div className='px-5 py-4'>
              <input
                type='url'
                value={linkDraft}
                onChange={e => setLinkDraft(e.target.value)}
                placeholder='https://...'
                className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700'
              />
              {linkError ? (
                <p className='mt-2 text-sm text-red-600'>{linkError}</p>
              ) : null}
            </div>
            <div className='flex justify-end gap-2 border-t border-gray-200 px-5 py-4'>
              <button
                type='button'
                onClick={() => {
                  setIsLinkModalOpen(false);
                  setLinkError(null);
                }}
                className='inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100'
              >
                Annuler
              </button>
              <button
                type='button'
                onClick={submitLinkOnEditor}
                className='inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700'
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function LeadsPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const role = String(user?.publicMetadata?.role || '')
    .trim()
    .toLowerCase();
  const isAdmin = role === 'admin';
  const [leads, setLeads] = useState<Lead[]>([]);
  const [collapsedStatuses, setCollapsedStatuses] = useState<
    Record<LeadStatus, boolean>
  >(() =>
    LEAD_COLUMNS.reduce(
      (acc, column) => {
        acc[column.key] = false;
        return acc;
      },
      {} as Record<LeadStatus, boolean>
    )
  );
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadStore, setNewLeadStore] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadEmail, setNewLeadEmail] = useState('');
  const [newLeadWebLink, setNewLeadWebLink] = useState('');
  const [newLeadQuickNote, setNewLeadQuickNote] = useState('');
  const [newLeadNote, setNewLeadNote] = useState('');
  const [newLeadImageUrlInput, setNewLeadImageUrlInput] = useState('');
  const [newLeadImageUrls, setNewLeadImageUrls] = useState<string[]>([]);
  const [newLeadStatus, setNewLeadStatus] = useState<LeadStatus>('A contacter');
  const [newLeadImageAddedAtByUrl, setNewLeadImageAddedAtByUrl] = useState<
    Record<string, string>
  >({});
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [createLeadError, setCreateLeadError] = useState<string | null>(null);
  const [loadLeadsError, setLoadLeadsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateLinkModalOpen, setIsCreateLinkModalOpen] = useState(false);
  const [createLinkDraft, setCreateLinkDraft] = useState('https://');
  const [createLinkModalError, setCreateLinkModalError] = useState<
    string | null
  >(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );
  const createNoteEditor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Highlight,
      LinkExtension.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
      }),
    ],
    content: newLeadNote || '<p></p>',
    onUpdate: ({ editor }) => {
      setNewLeadNote(editor.getHTML());
    },
  });
  const trimmedNewLeadName = newLeadName.trim();
  const trimmedNewLeadStore = newLeadStore.trim();
  const hasPhoneValue = Boolean(newLeadPhone.trim());
  const isNewLeadPhoneValid =
    !hasPhoneValue || isValidPhoneNumber(newLeadPhone);
  const isNewLeadEmailValid = isValidEmailFormat(newLeadEmail);
  const isNewLeadWebLinkValid = isValidWebLinkFormat(newLeadWebLink);
  const trimmedNewLeadImageUrlInput = newLeadImageUrlInput.trim();
  const isNewLeadImageUrlDraftInvalid =
    Boolean(trimmedNewLeadImageUrlInput) &&
    !isValidWebLinkFormat(trimmedNewLeadImageUrlInput);
  const isCreateLeadDisabled =
    !trimmedNewLeadName ||
    !trimmedNewLeadStore ||
    !isNewLeadPhoneValid ||
    !isNewLeadEmailValid ||
    !isNewLeadWebLinkValid ||
    isNewLeadImageUrlDraftInvalid;

  const filteredLeads = useMemo(() => {
    const query = normalizeSearchText(searchQuery);
    if (!query) return leads;
    return leads.filter(lead => {
      const leadName = normalizeSearchText(lead.name);
      const leadStore = normalizeSearchText(lead.store);
      return leadName.includes(query) || leadStore.includes(query);
    });
  }, [leads, searchQuery]);

  const leadsByStatus = useMemo(
    () =>
      LEAD_COLUMNS.reduce(
        (acc, column) => {
          acc[column.key] = filteredLeads.filter(
            lead => lead.status === column.key
          );
          return acc;
        },
        {} as Record<LeadStatus, Lead[]>
      ),
    [filteredLeads]
  );
  const selectedLead = useMemo(
    () => leads.find(lead => lead.id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  useEffect(() => {
    if (!createNoteEditor) return;
    const nextContent = newLeadNote || '<p></p>';
    if (createNoteEditor.getHTML() !== nextContent) {
      createNoteEditor.commands.setContent(nextContent);
    }
  }, [createNoteEditor, newLeadNote]);

  useEffect(() => {
    setNewLeadImageAddedAtByUrl(prev => {
      const existingUrls = new Set(newLeadImageUrls || []);
      let changed = false;
      const next: Record<string, string> = {};

      Object.entries(prev).forEach(([url, addedAt]) => {
        if (existingUrls.has(url)) next[url] = addedAt;
        else changed = true;
      });

      (newLeadImageUrls || []).forEach(url => {
        if (!next[url]) {
          next[url] = new Date().toISOString();
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [newLeadImageUrls]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const loadLeads = async () => {
      try {
        setLoadLeadsError(null);
        const token = await getToken();
        const response = await apiGet('/api/admin/leads', {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        });
        const json = await response.json();
        const rows = Array.isArray(json?.leads) ? json.leads : [];
        if (cancelled) return;
        setLeads(rows.map(mapApiLeadToLead));
      } catch (e: any) {
        if (cancelled) return;
        setLoadLeadsError(e?.message || 'Erreur lors du chargement des leads');
      }
    };

    void loadLeads();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, getToken]);

  const createLead = async () => {
    const name = trimmedNewLeadName;
    const store = trimmedNewLeadStore;
    const phone = newLeadPhone.trim();
    const email = newLeadEmail.trim();
    const webLink = newLeadWebLink.trim();
    const quickNote = newLeadQuickNote.trim();
    const note = newLeadNote.trim();
    const imageUrl = joinImageUrlsForStorage(newLeadImageUrls);

    if (!name || !store) {
      setCreateLeadError('Les champs Nom et Boutique sont obligatoires.');
      return;
    }
    if (phone && !isValidPhoneNumber(phone)) {
      setCreateLeadError('Le numéro de téléphone est invalide.');
      return;
    }
    if (!isValidEmailFormat(email)) {
      setCreateLeadError("L'adresse e-mail est invalide.");
      return;
    }
    if (!isValidWebLinkFormat(webLink)) {
      setCreateLeadError('Le lien web est invalide.');
      return;
    }
    if (store) {
      const normalizedStore = normalizeStoreForCompare(store);
      const exists = leads.some(
        lead => normalizeStoreForCompare(lead.store) === normalizedStore
      );
      if (exists) {
        setCreateLeadError('Cette boutique existe deja');
        return;
      }
    }

    try {
      setCreateLeadError(null);
      const token = await getToken();
      const response = await apiPost(
        '/api/admin/leads',
        {
          name,
          store,
          phone,
          email,
          webLink,
          quickNote,
          note,
          imageUrl,
          status: newLeadStatus,
        },
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      const json = await response.json();
      const createdLead = mapApiLeadToLead(json?.lead);

      setLeads(prev => [createdLead, ...prev]);
      setNewLeadName('');
      setNewLeadStore('');
      setNewLeadPhone('');
      setNewLeadEmail('');
      setNewLeadWebLink('');
      setNewLeadQuickNote('');
      setNewLeadNote('');
      setNewLeadImageUrlInput('');
      setNewLeadImageUrls([]);
      setNewLeadImageAddedAtByUrl({});
      setNewLeadStatus('A contacter');
      setIsCreateModalOpen(false);
    } catch (e: any) {
      setCreateLeadError(
        extractApiErrorMessage(e, 'Erreur lors de la creation du lead')
      );
    }
  };

  const moveLeadToStatus = async (leadId: string, nextStatus: LeadStatus) => {
    const previousLead = leads.find(lead => lead.id === leadId);
    if (!previousLead || previousLead.status === nextStatus) return;

    setLeads(prev =>
      prev.map(lead =>
        lead.id === leadId ? { ...lead, status: nextStatus } : lead
      )
    );

    try {
      const token = await getToken();
      await apiPut(
        `/api/admin/leads/${encodeURIComponent(leadId)}/status`,
        { status: STATUS_LABEL_TO_ID[nextStatus] },
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
    } catch (e) {
      // rollback visuel si l'API échoue
      setLeads(prev =>
        prev.map(lead =>
          lead.id === leadId ? { ...lead, status: previousLead.status } : lead
        )
      );
    }
  };

  const saveQuickNote = (leadId: string, quickNote: string) => {
    void updateLeadFields(leadId, { quickNote });
  };

  const updateLeadFields = async (
    leadId: string,
    updates: Partial<
      Pick<
        Lead,
        | 'name'
        | 'store'
        | 'phone'
        | 'email'
        | 'webLink'
        | 'quickNote'
        | 'note'
        | 'imageUrls'
      >
    >
  ) => {
    const previousLead = leads.find(lead => lead.id === leadId);
    if (!previousLead) return;
    if (Object.prototype.hasOwnProperty.call(updates, 'store')) {
      const nextStore = normalizeStoreForCompare(String(updates.store || ''));
      if (nextStore) {
        const exists = leads.some(
          lead =>
            lead.id !== leadId &&
            normalizeStoreForCompare(lead.store) === nextStore
        );
        if (exists) {
          throw new Error('Cette boutique existe deja');
        }
      }
    }

    setLeads(prev =>
      prev.map(lead => (lead.id === leadId ? { ...lead, ...updates } : lead))
    );

    try {
      const token = await getToken();
      const updatesForApi: Record<string, unknown> = { ...updates };
      if (Object.prototype.hasOwnProperty.call(updates, 'imageUrls')) {
        updatesForApi.imageUrl = joinImageUrlsForStorage(
          Array.isArray(updates.imageUrls) ? updates.imageUrls : []
        );
        delete updatesForApi.imageUrls;
      }
      await apiPut(
        `/api/admin/leads/${encodeURIComponent(leadId)}`,
        updatesForApi,
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
    } catch (e) {
      setLeads(prev =>
        prev.map(lead => (lead.id === leadId ? previousLead : lead))
      );
      throw new Error(
        extractApiErrorMessage(e, 'Erreur lors de la mise a jour')
      );
    }
  };

  const deleteLead = async (leadId: string) => {
    const previousLeads = leads;
    setLeads(prev => prev.filter(lead => lead.id !== leadId));
    setSelectedLeadId(prev => (prev === leadId ? null : prev));
    try {
      const token = await getToken();
      await apiDelete(`/api/admin/leads/${encodeURIComponent(leadId)}`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
    } catch (e) {
      setLeads(previousLeads);
      throw new Error(
        extractApiErrorMessage(e, 'Erreur lors de la suppression du lead')
      );
    }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const leadId = String(active.id);
    const overId = String(over.id);
    let targetColumn: LeadStatus | null = null;

    if (overId.startsWith('column:')) {
      const statusRaw = overId.replace('column:', '').trim();
      targetColumn = isLeadStatusLabel(statusRaw) ? statusRaw : null;
    } else {
      const overLead = leads.find(item => item.id === overId);
      if (overLead) {
        targetColumn = overLead.status;
      }
    }

    if (!targetColumn) return;

    const lead = leads.find(item => item.id === leadId);
    if (!lead || lead.status === targetColumn) return;
    void moveLeadToStatus(leadId, targetColumn);
  };

  const toggleColumn = (status: LeadStatus) => {
    setCollapsedStatuses(prev => ({ ...prev, [status]: !prev[status] }));
  };
  const createModalToolbarButtonClass =
    'inline-flex items-center rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100';

  const openLinkModalForCreateEditor = () => {
    const currentHref = String(
      createNoteEditor?.getAttributes('link')?.href || ''
    ).trim();
    setCreateLinkDraft(currentHref || 'https://');
    setCreateLinkModalError(null);
    setIsCreateLinkModalOpen(true);
  };

  const submitLinkOnCreateEditor = () => {
    const normalizedUrl = createLinkDraft.trim();
    if (!normalizedUrl) {
      createNoteEditor?.chain().focus().unsetLink().run();
      setIsCreateLinkModalOpen(false);
      setCreateLinkModalError(null);
      return;
    }
    if (!isValidWebLinkFormat(normalizedUrl)) {
      setCreateLinkModalError(
        'Lien invalide. Utilisez un lien commençant par http:// ou https://'
      );
      return;
    }
    setCreateLinkModalError(null);
    setCreateLeadError(null);
    createNoteEditor
      ?.chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: normalizedUrl })
      .run();
    setIsCreateLinkModalOpen(false);
  };

  const addCreateImageUrl = () => {
    const nextValue = newLeadImageUrlInput.trim();
    if (!nextValue) return;
    if (!isValidWebLinkFormat(nextValue)) {
      setCreateLeadError('Lien image invalide.');
      return;
    }
    setCreateLeadError(null);
    setNewLeadImageUrls(prev => {
      const next = new Set((prev || []).map(url => String(url || '').trim()));
      next.add(nextValue);
      return Array.from(next);
    });
    setNewLeadImageAddedAtByUrl(prev => ({
      ...prev,
      [nextValue]: new Date().toISOString(),
    }));
    setNewLeadImageUrlInput('');
  };

  const removeCreateImageUrl = (urlToRemove: string) => {
    const target = String(urlToRemove || '').trim();
    setNewLeadImageUrls(prev =>
      (prev || []).filter(url => String(url || '').trim() !== target)
    );
    setNewLeadImageAddedAtByUrl(prev => {
      const next = { ...prev };
      delete next[target];
      return next;
    });
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
          <div className='w-full px-6 pt-16 pb-6'>
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

            <div className='mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div className='w-full sm:max-w-md'>
                <input
                  type='text'
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder='Rechercher par boutique ou prospect...'
                  className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700'
                />
              </div>
              <button
                type='button'
                onClick={() => setIsCreateModalOpen(true)}
                className='inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700'
              >
                Ajouter un prospect
              </button>
            </div>

            {loadLeadsError ? (
              <div className='mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'>
                {loadLeadsError}
              </div>
            ) : null}

            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <div className='overflow-x-auto pb-2'>
                <div className='inline-flex min-w-max gap-4'>
                  {LEAD_COLUMNS.map(column => (
                    <LeadColumnLane
                      key={column.key}
                      column={column}
                      leads={leadsByStatus[column.key]}
                      isCollapsed={collapsedStatuses[column.key]}
                      onToggle={toggleColumn}
                      onSaveQuickNote={saveQuickNote}
                      onOpenLead={setSelectedLeadId}
                    />
                  ))}
                </div>
              </div>
            </DndContext>

            {selectedLead ? (
              <LeadDetailsModal
                lead={selectedLead}
                onClose={() => setSelectedLeadId(null)}
                onUpdateLead={updateLeadFields}
                onDeleteLead={deleteLead}
              />
            ) : null}

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
                      <svg
                        xmlns='http://www.w3.org/2000/svg'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2'
                        className='h-4 w-4'
                        aria-hidden='true'
                      >
                        <path d='M18 6 6 18' />
                        <path d='m6 6 12 12' />
                      </svg>
                    </button>
                  </div>

                  <div className='p-5'>
                    {createLeadError ? (
                      <div className='mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'>
                        {createLeadError}
                      </div>
                    ) : null}
                    <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                      <input
                        type='text'
                        value={newLeadName}
                        onChange={e => setNewLeadName(e.target.value)}
                        placeholder='Nom du prospect *'
                        className={`w-full rounded-lg border px-3 py-2 text-sm ${
                          !trimmedNewLeadName ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      <input
                        type='text'
                        value={newLeadStore}
                        onChange={e => setNewLeadStore(e.target.value)}
                        placeholder='Boutique *'
                        className={`w-full rounded-lg border px-3 py-2 text-sm ${
                          !trimmedNewLeadStore ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      <PhoneInput
                        international
                        defaultCountry='FR'
                        value={newLeadPhone}
                        onChange={value => setNewLeadPhone(value || '')}
                        placeholder='Téléphone'
                        className={`w-full rounded-lg border px-3 py-2 text-sm ${
                          hasPhoneValue && !isNewLeadPhoneValid
                            ? 'border-red-400'
                            : 'border-gray-300'
                        }`}
                      />
                      <input
                        type='email'
                        value={newLeadEmail}
                        onChange={e => setNewLeadEmail(e.target.value)}
                        placeholder='E-mail'
                        className={`w-full rounded-lg border px-3 py-2 text-sm ${
                          !isNewLeadEmailValid ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      <input
                        type='url'
                        value={newLeadWebLink}
                        onChange={e => setNewLeadWebLink(e.target.value)}
                        placeholder='Lien web'
                        className={`w-full rounded-lg border px-3 py-2 text-sm md:col-span-2 ${
                          !isNewLeadWebLinkValid ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      <input
                        type='text'
                        value={newLeadQuickNote}
                        onChange={e => setNewLeadQuickNote(e.target.value)}
                        placeholder='Note Rapide'
                        className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm md:col-span-2'
                      />
                      <div className='md:col-span-2'>
                        <p className='mb-2 text-sm font-semibold text-gray-900'>
                          Note enrichie
                        </p>
                        <div className='mb-2 flex flex-wrap gap-2'>
                          <button
                            type='button'
                            onClick={() =>
                              createNoteEditor
                                ?.chain()
                                .focus()
                                .toggleBold()
                                .run()
                            }
                            className={`${createModalToolbarButtonClass} ${
                              createNoteEditor?.isActive('bold')
                                ? 'bg-gray-200'
                                : ''
                            }`}
                          >
                            Gras
                          </button>
                          <button
                            type='button'
                            onClick={() =>
                              createNoteEditor
                                ?.chain()
                                .focus()
                                .toggleItalic()
                                .run()
                            }
                            className={`${createModalToolbarButtonClass} ${
                              createNoteEditor?.isActive('italic')
                                ? 'bg-gray-200'
                                : ''
                            }`}
                          >
                            Italique
                          </button>
                          <button
                            type='button'
                            onClick={() =>
                              createNoteEditor
                                ?.chain()
                                .focus()
                                .toggleUnderline()
                                .run()
                            }
                            className={`${createModalToolbarButtonClass} ${
                              createNoteEditor?.isActive('underline')
                                ? 'bg-gray-200'
                                : ''
                            }`}
                          >
                            Souligné
                          </button>
                          <button
                            type='button'
                            onClick={() =>
                              createNoteEditor
                                ?.chain()
                                .focus()
                                .toggleBulletList()
                                .run()
                            }
                            className={`${createModalToolbarButtonClass} ${
                              createNoteEditor?.isActive('bulletList')
                                ? 'bg-gray-200'
                                : ''
                            }`}
                          >
                            Puces
                          </button>
                          <button
                            type='button'
                            onClick={() =>
                              createNoteEditor
                                ?.chain()
                                .focus()
                                .toggleHighlight()
                                .run()
                            }
                            className={`${createModalToolbarButtonClass} ${
                              createNoteEditor?.isActive('highlight')
                                ? 'bg-yellow-200'
                                : ''
                            }`}
                          >
                            Surligner jaune
                          </button>
                          <button
                            type='button'
                            onClick={openLinkModalForCreateEditor}
                            className={`${createModalToolbarButtonClass} ${
                              createNoteEditor?.isActive('link')
                                ? 'bg-blue-100 text-blue-700'
                                : ''
                            }`}
                          >
                            Lien
                          </button>
                        </div>
                        <div className='rounded-lg border border-gray-300 bg-white p-3'>
                          <EditorContent
                            editor={createNoteEditor}
                            className='tiptap-content min-h-[160px] text-sm [&_.ProseMirror]:min-h-[140px] [&_.ProseMirror]:outline-none'
                          />
                        </div>
                        <div className='mt-4'>
                          <div className='mb-2 flex items-center gap-2'>
                            <p className='text-sm font-semibold text-gray-900'>
                              Pieces jointes
                            </p>
                            <span className='inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-gray-100 px-2 text-xs font-semibold text-gray-700'>
                              {newLeadImageUrls.length}
                            </span>
                          </div>
                          <div className='flex items-center gap-2'>
                            <input
                              type='url'
                              value={newLeadImageUrlInput}
                              onChange={e =>
                                setNewLeadImageUrlInput(e.target.value)
                              }
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addCreateImageUrl();
                                }
                              }}
                              placeholder='https://...'
                              className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-700 ${
                                isNewLeadImageUrlDraftInvalid
                                  ? 'border-red-400'
                                  : 'border-gray-300'
                              }`}
                            />
                            <button
                              type='button'
                              onClick={addCreateImageUrl}
                              className='inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100'
                            >
                              Ajouter
                            </button>
                          </div>
                          {newLeadImageUrls.length > 0 ? (
                            <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'>
                              {newLeadImageUrls.map(url => (
                                <div
                                  key={url}
                                  className='overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm'
                                >
                                  <a
                                    href={toBrowserUrl(url)}
                                    target='_blank'
                                    rel='noreferrer'
                                    className='block group'
                                  >
                                    <img
                                      src={url}
                                      alt={getImageAttachmentLabel(url)}
                                      className='h-32 w-full object-cover bg-gray-50'
                                    />
                                    <div className='px-3 py-2 text-sm text-gray-800'>
                                      <p className='truncate font-medium'>
                                        {getImageAttachmentLabel(url)}
                                      </p>
                                      {newLeadImageAddedAtByUrl[url] ? (
                                        <p className='truncate text-xs text-gray-500'>
                                          Ajoutée le{' '}
                                          {formatAttachmentAddedAt(
                                            newLeadImageAddedAtByUrl[url]
                                          )}
                                        </p>
                                      ) : null}
                                      <p className='truncate text-xs text-indigo-600 group-hover:underline'>
                                        {url}
                                      </p>
                                    </div>
                                  </a>
                                  <div className='border-t border-gray-100 px-3 py-2'>
                                    <button
                                      type='button'
                                      onClick={() => removeCreateImageUrl(url)}
                                      className='inline-flex items-center rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50'
                                    >
                                      Retirer
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {hasPhoneValue && !isNewLeadPhoneValid ? (
                      <p className='mt-3 text-sm text-red-600'>
                        Numéro de téléphone invalide.
                      </p>
                    ) : null}
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
                      disabled={isCreateLeadDisabled}
                      className='inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      Valider
                    </button>
                  </div>
                </div>
                {isCreateLinkModalOpen ? (
                  <div
                    className='fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4'
                    onClick={() => {
                      setIsCreateLinkModalOpen(false);
                      setCreateLinkModalError(null);
                    }}
                  >
                    <div
                      className='w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl'
                      onClick={e => e.stopPropagation()}
                    >
                      <div className='border-b border-gray-200 px-5 py-4'>
                        <h3 className='text-base font-semibold text-gray-900'>
                          Ajouter un lien
                        </h3>
                      </div>
                      <div className='px-5 py-4'>
                        <input
                          type='url'
                          value={createLinkDraft}
                          onChange={e => setCreateLinkDraft(e.target.value)}
                          placeholder='https://...'
                          className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700'
                        />
                        {createLinkModalError ? (
                          <p className='mt-2 text-sm text-red-600'>
                            {createLinkModalError}
                          </p>
                        ) : null}
                      </div>
                      <div className='flex justify-end gap-2 border-t border-gray-200 px-5 py-4'>
                        <button
                          type='button'
                          onClick={() => {
                            setIsCreateLinkModalOpen(false);
                            setCreateLinkModalError(null);
                          }}
                          className='inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100'
                        >
                          Annuler
                        </button>
                        <button
                          type='button'
                          onClick={submitLinkOnCreateEditor}
                          className='inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700'
                        >
                          Valider
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
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

