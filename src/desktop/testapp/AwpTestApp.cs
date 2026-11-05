// DISPOSABLE TEST APPLICATION for the desktop engine's real-Windows tests (WPF, because WPF exposes UI Automation natively). It holds only fake data,
// writes only where its command line says, and is compiled by the test into a temporary folder (C# 5, .NET Framework csc). Never installed, never shipped.
//
// Command line (all optional):  --title TEXT   --prefill TEXT   --state FILE   --out FILE   --handoff
//   --state   write a small JSON file every 250 ms with what the window holds (so a test can check, from outside, that a window was NOT changed)
//   --out     the "Write file" button writes the notes text to this path
//   --handoff behave like a single-instance / Store launcher: start another copy of this program and exit WITHOUT showing a window
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

public class AwpWindow : Window {
  TextBox notes = new TextBox();
  PasswordBox password = new PasswordBox();
  CheckBox feature = new CheckBox();
  TextBlock ocrLabel = new TextBlock();
  TextBox result = new TextBox();
  string statePath, outPath, title;

  static string Arg(string[] a, string name) {
    for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
    return null;
  }
  static string Esc(string s) {
    if (s == null) return "";
    StringBuilder b = new StringBuilder();
    foreach (char c in s) {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c == '\r') b.Append("\\r");
      else if (c == '\n') b.Append("\\n");
      else if (c < 32 || c > 126) b.Append("\\u").Append(((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.ToString();
  }

  [STAThread]
  public static void Main(string[] args) {
    if (Array.IndexOf(args, "--handoff") >= 0) {
      ProcessStartInfo psi = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName);
      string st = Arg(args, "--state");
      psi.Arguments = "--title Handed-over-copy" + (st != null ? " --state \"" + st + "\"" : "");
      psi.UseShellExecute = false;
      Process.Start(psi);
      return;
    }
    new Application().Run(new AwpWindow(args));
  }

  public AwpWindow(string[] args) {
    title = Arg(args, "--title") ?? "AWP Test App";
    statePath = Arg(args, "--state");
    outPath = Arg(args, "--out");
    Title = title;
    Width = 560; Height = 420;
    WindowStartupLocation = WindowStartupLocation.Manual;
    Left = 80; Top = 80;

    StackPanel p = new StackPanel(); p.Margin = new Thickness(12);
    notes.Text = Arg(args, "--prefill") ?? "";
    NameOf(notes, "Notes");
    password.Password = "fake-password-for-tests";
    NameOf(password, "Password");
    feature.Content = "Enable feature";
    ocrLabel.Text = "OCR-TEST-4711 hello world"; ocrLabel.FontSize = 28; ocrLabel.FontWeight = FontWeights.Bold; ocrLabel.Margin = new Thickness(0, 10, 0, 10);
    result.Text = "Result: none"; result.IsReadOnly = true; result.BorderThickness = new Thickness(0); NameOf(result, "Result");

    WrapPanel buttons = new WrapPanel();
    Button compute = Btn("Compute"); compute.Click += delegate { result.Text = "Result: 42"; };
    Button boom = Btn("Show Message"); boom.Click += delegate { MessageBox.Show(this, "Unexpected dialog text", "Surprise", MessageBoxButton.OK); };
    Button saveAs = Btn("Save As...");
    saveAs.Click += delegate {
      Microsoft.Win32.SaveFileDialog d = new Microsoft.Win32.SaveFileDialog();
      d.Title = "Save test file"; d.Filter = "Text|*.txt|All|*.*"; d.OverwritePrompt = true;
      if (d.ShowDialog(this) == true) File.WriteAllText(d.FileName, notes.Text);
    };
    // "Open..." loads a text file chosen in the standard Windows Open dialog into the Notes box (at most 4,000 characters), so the
    // engine's file_dialog "open" step (folder READ permission) and editing an existing file can be tested on a real window.
    Button open = Btn("Open...");
    open.Click += delegate {
      Microsoft.Win32.OpenFileDialog d = new Microsoft.Win32.OpenFileDialog();
      d.Title = "Open test file"; d.Filter = "Text|*.txt|All|*.*";
      if (d.ShowDialog(this) == true) {
        string loaded = File.ReadAllText(d.FileName);
        notes.Text = loaded.Length > 4000 ? loaded.Substring(0, 4000) : loaded;
      }
    };
    Button write = Btn("Write file");
    write.Click += delegate { if (outPath != null) File.WriteAllText(outPath, notes.Text); };
    buttons.Children.Add(compute); buttons.Children.Add(boom); buttons.Children.Add(open); buttons.Children.Add(saveAs); buttons.Children.Add(write);

    p.Children.Add(new TextBlock { Text = "Type here:" });
    p.Children.Add(notes);
    p.Children.Add(new TextBlock { Text = "Secret:", Margin = new Thickness(0, 8, 0, 0) });
    p.Children.Add(password);
    p.Children.Add(feature);
    p.Children.Add(ocrLabel);
    p.Children.Add(result);
    p.Children.Add(buttons);
    Content = p;

    DispatcherTimer t = new DispatcherTimer(); t.Interval = TimeSpan.FromMilliseconds(250);
    t.Tick += delegate { WriteState(false); };
    t.Start();
    Closed += delegate { WriteState(true); };
  }

  static void NameOf(DependencyObject o, string name) { System.Windows.Automation.AutomationProperties.SetName(o, name); }
  Button Btn(string text) { Button b = new Button(); b.Content = text; b.Width = 110; b.Height = 30; b.Margin = new Thickness(0, 6, 8, 0); return b; }

  void WriteState(bool closed) {
    if (statePath == null) return;
    try {
      long h = new WindowInteropHelper(this).Handle.ToInt64();
      string json = "{\"pid\":" + Process.GetCurrentProcess().Id + ",\"handle\":" + h + ",\"title\":\"" + Esc(title) + "\",\"notes\":\"" + Esc(notes.Text) + "\",\"password\":\"" + Esc(password.Password) + "\",\"feature\":" + (feature.IsChecked == true ? "true" : "false") + ",\"result\":\"" + Esc(result.Text) + "\",\"closed\":" + (closed ? "true" : "false") + "}";
      File.WriteAllText(statePath, json);
    } catch { }
  }
}
