import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';

import Header from '../components/Header';


const ToolsHubPage = ({ hub }) => {
  const navigate = useNavigate();
  if (!hub) return null;
  const HubIcon = hub.icon;

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-start justify-between gap-4 mb-7">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 flex items-center justify-center bg-[#F5C518] border border-yellow-600 rounded-md shrink-0">
              <HubIcon size={23} className="text-gray-950" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-950 uppercase">
                {hub.title}
              </h1>
              <p className="text-sm text-gray-600 mt-1">{hub.description}</p>
            </div>
          </div>
          <button
            type="button"
            data-testid="tools-hub-back"
            onClick={() => navigate('/home')}
            className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-2 rounded-md font-semibold text-sm shrink-0"
          >
            <ArrowLeft size={17} aria-hidden="true" />
            <span className="hidden sm:inline">Indietro</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {hub.items.map(item => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.path}
                type="button"
                data-testid={item.testId}
                onClick={() => navigate(item.path)}
                className="group min-h-32 text-left bg-white border border-gray-300 hover:border-yellow-500 rounded-lg p-5 transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-500"
              >
                <span className="h-full flex items-start gap-4">
                  <span className="h-10 w-10 flex items-center justify-center bg-gray-100 border border-gray-200 rounded-md shrink-0 group-hover:bg-yellow-50">
                    <ItemIcon size={21} className="text-gray-800" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-bold text-lg text-gray-900">{item.title}</span>
                      <ChevronRight size={19} className="text-gray-400 group-hover:text-yellow-700 shrink-0" aria-hidden="true" />
                    </span>
                    <span className="block text-sm text-gray-500 mt-1">{item.description}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default ToolsHubPage;
