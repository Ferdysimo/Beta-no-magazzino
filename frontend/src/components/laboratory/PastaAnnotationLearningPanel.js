import React from 'react';
import {
  Check,
  GitMerge,
  RotateCcw,
  Unlink,
} from 'lucide-react';
import { formatSourceTerms } from '../../utils/laboratory';

const breakdownText = values => (
  Object.entries(values || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => `${label} ${count}`)
    .join(' / ')
);

const LearningProfile = ({ profile, isCanonical }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-2 flex-wrap">
      <p className="text-lg font-bold text-gray-950">{profile.target}</p>
      {isCanonical && (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase text-green-800">
          <Check size={13} aria-hidden="true" />
          Termine principale
        </span>
      )}
    </div>
    <p className="text-sm font-semibold text-gray-600 mt-1">
      {Number(profile.count || 0).toLocaleString('it-IT')} occorrenze
    </p>
    {(profile.source_terms || []).length > 0 && (
      <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
        {formatSourceTerms(profile.source_terms, 3)}
      </p>
    )}
    <p className="text-xs text-gray-500 mt-1">
      {breakdownText(profile.location_counts)}
    </p>
  </div>
);

const PastaAnnotationLearningPanel = ({
  suggestions,
  confirmedAliases,
  dismissedPairs,
  message,
  saving,
  onDecision,
  onUndo,
}) => {
  const decisions = [...confirmedAliases, ...dismissedPairs];

  return (
    <div>
      <div className="grid grid-cols-3 border-b border-gray-300">
        <div className="p-4 border-r border-gray-300">
          <p className="text-xs font-bold uppercase text-gray-500">Da verificare</p>
          <p className="text-xl font-bold text-gray-950 mt-1">{suggestions.length}</p>
        </div>
        <div className="p-4 border-r border-gray-300">
          <p className="text-xs font-bold uppercase text-gray-500">Regole apprese</p>
          <p className="text-xl font-bold text-gray-950 mt-1">{confirmedAliases.length}</p>
        </div>
        <div className="p-4">
          <p className="text-xs font-bold uppercase text-gray-500">Coppie diverse</p>
          <p className="text-xl font-bold text-gray-950 mt-1">{dismissedPairs.length}</p>
        </div>
      </div>

      {message && (
        <div className="px-4 py-3 bg-green-50 border-b border-green-200 text-sm font-semibold text-green-900">
          {message}
        </div>
      )}

      <div className="divide-y divide-gray-200">
        {suggestions.length === 0 ? (
          <div className="min-h-[220px] flex flex-col items-center justify-center text-center px-6">
            <Check size={30} className="text-green-700" aria-hidden="true" />
            <p className="mt-3 font-bold text-gray-800">Nessun dubbio da risolvere</p>
            <p className="text-sm text-gray-500 mt-1">
              Con questo periodo e questi filtri non risultano coppie plausibili.
            </p>
          </div>
        ) : suggestions.map(item => (
          <article key={item.id} className="px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-xs font-bold uppercase text-gray-500">
                {item.reason}
              </p>
              <span className="text-xs font-bold text-gray-700">
                Somiglianza {item.similarity_percent}%
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)_auto] gap-3 lg:items-center">
              <LearningProfile
                profile={item.left}
                isCanonical={item.left.target === item.suggested_canonical}
              />
              <div className="hidden lg:flex items-center justify-center text-gray-400">
                <GitMerge size={20} aria-hidden="true" />
              </div>
              <LearningProfile
                profile={item.right}
                isCanonical={item.right.target === item.suggested_canonical}
              />
              <div className="flex lg:flex-col gap-2 lg:w-32">
                <button
                  type="button"
                  onClick={() => onDecision(item, 'same')}
                  disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 text-white px-3 py-2 rounded-md text-sm font-bold disabled:opacity-50"
                >
                  <GitMerge size={16} aria-hidden="true" />
                  Uguali
                </button>
                <button
                  type="button"
                  onClick={() => onDecision(item, 'different')}
                  disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-2 rounded-md text-sm font-bold disabled:opacity-50"
                >
                  <Unlink size={16} aria-hidden="true" />
                  Diverse
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {decisions.length > 0 && (
        <details className="border-t border-gray-300">
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-gray-800">
            Decisioni registrate ({decisions.length})
          </summary>
          <div className="grid grid-cols-1 lg:grid-cols-2 border-t border-gray-200">
            <div className="p-4 lg:border-r border-gray-200">
              <p className="text-xs font-bold uppercase text-gray-500 mb-2">
                Regole apprese
              </p>
              {confirmedAliases.length === 0 ? (
                <p className="text-sm text-gray-500">Nessuna regola confermata</p>
              ) : (
                <div className="divide-y divide-gray-200">
                  {confirmedAliases.map(item => (
                    <div key={item.id} className="py-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-800">
                        {item.alias_normalized} diventa {item.canonical_normalized}
                      </p>
                      <button
                        type="button"
                        onClick={() => onUndo(item)}
                        disabled={saving}
                        title="Annulla regola"
                        aria-label={`Annulla regola ${item.alias_normalized}`}
                        className="w-9 h-9 inline-flex items-center justify-center text-gray-500 hover:text-red-700 hover:bg-red-50 rounded-md disabled:opacity-50"
                      >
                        <RotateCcw size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t lg:border-t-0 border-gray-200">
              <p className="text-xs font-bold uppercase text-gray-500 mb-2">
                Coppie escluse
              </p>
              {dismissedPairs.length === 0 ? (
                <p className="text-sm text-gray-500">Nessuna coppia esclusa</p>
              ) : (
                <div className="divide-y divide-gray-200">
                  {dismissedPairs.map(item => (
                    <div key={item.id} className="py-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-800">
                        {item.left_normalized} e {item.right_normalized} sono diversi
                      </p>
                      <button
                        type="button"
                        onClick={() => onUndo(item)}
                        disabled={saving}
                        title="Ripristina proposta"
                        aria-label={`Ripristina proposta ${item.left_normalized} e ${item.right_normalized}`}
                        className="w-9 h-9 inline-flex items-center justify-center text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded-md disabled:opacity-50"
                      >
                        <RotateCcw size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </details>
      )}
    </div>
  );
};

export default PastaAnnotationLearningPanel;
