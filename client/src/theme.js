import { createTheme } from '@mui/material/styles';

// Design tokens
export const tokens = {
  ink: '#17324D',      // navigation, headings
  rx: '#1E6B57',       // primary actions — prescription green
  paper: '#F1F4F6',    // app background
  line: '#D5DDE3',     // hairlines, outlines
  alert: '#B42318',
  amber: '#9A5B00',
  serif: '"Source Serif 4", Georgia, serif',
};

export const theme = createTheme({
  palette: {
    primary: { main: tokens.rx, contrastText: '#fff' },
    secondary: { main: tokens.ink },
    error: { main: tokens.alert },
    warning: { main: tokens.amber },
    background: { default: tokens.paper, paper: '#FFFFFF' },
    text: { primary: '#1B2733', secondary: '#55636F' },
    divider: tokens.line,
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: '"Public Sans", system-ui, sans-serif',
    h1: { fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.01em', color: tokens.ink },
    h2: { fontSize: '1.25rem', fontWeight: 600, color: tokens.ink },
    h3: { fontSize: '1rem', fontWeight: 600, color: tokens.ink },
    body2: { lineHeight: 1.55 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    // Print: hide app chrome and buttons so the prescription pad / invoice print cleanly
    MuiCssBaseline: {
      styleOverrides: {
        '@media print': {
          '.no-print': { display: 'none !important' },
          body: { background: '#fff' },
          '@page': { size: 'A5 portrait', margin: '12mm' },
        },
      },
    },
    MuiPaper: { defaultProps: { variant: 'outlined' } },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, color: '#55636F', fontSize: '0.8125rem', background: '#F7F9FA' },
        root: { borderColor: tokens.line },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiButtonBase: { styleOverrides: { root: { '&.Mui-focusVisible': { outline: `2px solid ${tokens.rx}`, outlineOffset: 2 } } } },
  },
});
