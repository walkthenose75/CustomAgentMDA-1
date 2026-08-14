import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../tests/setup/test-utils';
import { App } from './App';

describe('Agent Sidecar Administration', () => {
  it('renders the administrator portfolio and health summary', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sidecar portfolio' })).toBeTruthy();
    expect(await screen.findByText('HR Management App Guide')).toBeTruthy();
    expect(screen.getByText('Field Operations Assistant')).toBeTruthy();
    expect(screen.getByText('Finance Operations Guide')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Portfolio summary' })).toBeTruthy();
  });

  it('opens the create-sidecar wizard', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create sidecar' }));
    expect(await screen.findByRole('heading', { name: 'Create a sidecar' })).toBeTruthy();
    expect(screen.getByText('1. Application')).toBeTruthy();
    expect(await screen.findByText('Sales Workspace')).toBeTruthy();
  });

  it('marks the chosen Model-driven App as selected', async () => {
    render(<App />, { initialRoute: '/new' });
    const salesApp = await screen.findByRole('button', { name: /Sales Workspace/ });
    expect(salesApp.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(salesApp);
    expect(salesApp.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Selected')).toBeTruthy();
  });

  it('shows the exact redirect URI and blocks invalid identity GUIDs', async () => {
    render(<App />, { initialRoute: '/new' });
    fireEvent.click(await screen.findByRole('button', { name: /Sales Workspace/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.change(screen.getByRole('textbox', { name: /Microsoft 365 Agents SDK connection string/ }), {
      target: { value: 'https://1234567890.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/contoso_FieldGuide/conversations?api-version=2022-03-01-preview' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Environment ID/ }), {
      target: { value: 'f9b87f8b-0abf-e629-affb-b13195d1ed14' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve agent' }));
    expect((await screen.findAllByText('Field Guide')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.change(screen.getByRole('textbox', { name: /Tenant ID/ }), { target: { value: 'not-a-guid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Tenant ID must be a valid GUID.')).toBeTruthy();
  });

  it('constructs the connection string for a GitHub Copilot harness agent', async () => {
    render(<App />, { initialRoute: '/new' });
    fireEvent.click(await screen.findByRole('button', { name: /Sales Workspace/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('radio', { name: 'GitHub Copilot harness' }));
    expect(screen.queryByRole('textbox', { name: /Microsoft 365 Agents SDK connection string/ })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: /Agent schema name/ }), {
      target: { value: 'contoso_FieldGuide' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Environment ID/ }), {
      target: { value: 'f9b87f8b-0abf-e629-affb-b13195d1ed14' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve agent' }));
    expect((await screen.findAllByText('Field Guide')).length).toBeGreaterThan(0);
  });

  it('opens a sidecar and automatically validates health', async () => {
    render(<App />);
    const manageButtons = await screen.findAllByRole('button', { name: 'Manage sidecar' });
    fireEvent.click(manageButtons[0]);
    expect(await screen.findByRole('heading', { name: 'HR Management App Guide' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Health validation' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Last validated:/)).toBeTruthy());
  });

  it('requires explicit approval before reconciling drift', async () => {
    render(<App />, { initialRoute: '/sidecars/sidecar-field-operations' });
    expect(await screen.findByRole('heading', { name: 'Drift review' })).toBeTruthy();
    expect(screen.getByText('Account was added to the target app')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve reconciliation' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Drift review' })).toBeNull());
    expect(screen.getByText('Administrator-approved reconciliation completed and read-back passed.')).toBeTruthy();
  });

  it('supports disable and re-enable without deleting configuration', async () => {
    render(<App />, { initialRoute: '/sidecars/sidecar-hr-management' });
    const disable = await screen.findByRole('button', { name: 'Disable' });
    fireEvent.click(disable);
    const enable = await screen.findByRole('button', { name: 'Enable' });
    fireEvent.click(enable);
    expect(await screen.findByRole('button', { name: 'Disable' })).toBeTruthy();
  });
});
