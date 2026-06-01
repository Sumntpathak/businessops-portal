"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

interface TestCase<TForm> {
  label: string;
  description: string;
  values: TForm;
}

interface DemoCredential<TForm> {
  role: string;
  email: string;
  password: string;
  values: TForm;
}

interface AuthTestPanelProps<TForm> {
  title: string;
  testCases: TestCase<TForm>[];
  demoCredentials?: DemoCredential<TForm>[];
  onSelect: (values: TForm) => void;
}

export function AuthTestPanel<TForm>({
  demoCredentials,
  onSelect,
  testCases,
  title,
}: AuthTestPanelProps<TForm>) {
  const [showTests, setShowTests] = useState(false);
  const [showDemoCredentials, setShowDemoCredentials] = useState(false);

  return (
    <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-xs text-slate-500">Use these to quickly test validation and failures.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            className="min-h-8 px-3 text-xs"
            onClick={() => setShowTests((value) => !value)}
          >
            {showTests ? "Hide test cases" : "Show test cases"}
          </Button>
          {demoCredentials && (
            <Button
              variant="secondary"
              className="min-h-8 px-3 text-xs"
              onClick={() => setShowDemoCredentials((value) => !value)}
            >
              {showDemoCredentials ? "Hide demo users" : "Show demo users"}
            </Button>
          )}
        </div>
      </div>

      {showTests && (
        <div className="mt-4 space-y-2">
          {testCases.map((testCase) => (
            <button
              key={testCase.label}
              type="button"
              onClick={() => onSelect(testCase.values)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-100"
            >
              <span className="block text-sm font-medium text-slate-800">{testCase.label}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{testCase.description}</span>
            </button>
          ))}
        </div>
      )}

      {showDemoCredentials && demoCredentials && (
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {demoCredentials.map((credential) => (
            <div
              key={credential.email}
              className="grid gap-2 border-b border-slate-100 px-3 py-3 text-sm last:border-b-0 sm:grid-cols-[90px_1fr_auto]"
            >
              <span className="font-medium capitalize text-slate-800">{credential.role}</span>
              <span className="min-w-0 text-xs text-slate-500 sm:text-sm">
                <span className="block truncate">{credential.email}</span>
                <span className="block font-mono">{credential.password}</span>
              </span>
              <Button
                variant="ghost"
                className="min-h-8 justify-start px-3 text-xs sm:justify-center"
                onClick={() => onSelect(credential.values)}
              >
                Use
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
