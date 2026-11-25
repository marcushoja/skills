---
name: mh-extjs-architect
description: Erstellt, erweitert und prüft Ext-JS-Classic-Anwendungen nach den Strukturkonventionen von Sencha Architect – ohne den Generator zu benötigen. Verwenden bei Views, ViewModels, ViewControllern, Bindings, Formulas, Models, Stores, Proxys und anwendungsweiten Controllern.
---

# EXT-JS Architect Skill

Entwickle Ext-JS-Anwendungen so weiter, dass neuer Code zu einem mit Sencha Architect aufgebauten Projekt passt. Übernimm die Klassenstruktur, das MVVM-Muster und die Art der Verdrahtung – nicht den Generatorcode. Bevorzuge klare Regeln für neuen Code, ohne dafür den Bestand ungefragt umzubauen.

## 1. Bestand prüfen

- Ermittle Ext-JS-Version, Toolkit, Anwendungsnamespace, aktiven Quellbaum und Einstiegspunkt. Falls ein Architect-Projekt neben dem Laufzeit-Quellcode liegt, kläre, welcher Baum tatsächlich gebaut oder ausgeliefert wird. Gleiche die Bäume nicht ungefragt ab.
- Lies eine ähnliche bestehende View mit ihrem ViewModel und ViewController. Verfolge mindestens ein Binding bis zum Store oder zur Formula und einen Event-Handler bis zum Datenzugriff.
- Halte dich an vorhandene Namens- und Ladekonventionen, sofern sie zur Aufgabe passen. Verwende keine API, die erst in einer neueren Ext-JS-Version oder einem anderen Toolkit verfügbar ist.

## 2. Klassen nach Verantwortung aufteilen

| Klasse | Ablage nach Projektkonvention | Verantwortung |
|---|---|---|
| **View** | `app/view/<fachbereich>/<name>.js` | Layout, Komponenten, `xtype`, `reference`, Bindings und deklarative Events |
| **ViewModel** | Neben der View als `<name>ViewModel.js` | Instanzbezogener Zustand unter `data`, abgeleitete Werte unter `formulas`, lokale Stores unter `stores` |
| **ViewController** | Neben der View als `<name>ViewController.js` | Benutzeraktionen, Validierung, Laden und Speichern, Fehlerbehandlung und gezielte UI-Aktionen |
| **Model** | `app/model/` | Felder, Datentypen, ID, Mappings und gegebenenfalls Beziehungen |
| **Wiederverwendbare Store-Klasse** | `app/store/` | Gemeinsame Store-Konfiguration; wird erst durch Registrierung oder eine bewusst geteilte Instanz global |
| **Anwendungscontroller** | `app/controller/` | Anwendungsweite Abläufe und Events, nicht die Bedienung einer einzelnen View |

Definiere Klassen mit `Ext.define`. Verwende eindeutige Aliase im Projektstil: `widget.<alias>`, `controller.<alias>` und `viewmodel.<alias>`. Verdrahte die View über `controller: '<alias>'` und `viewModel: { type: '<alias>' }`. Gib die nötigen Klassen dort in `requires` an, wo sie gebraucht werden. Lege für einfache Unterkomponenten keine leeren Controller oder ViewModels an.

## 3. Bindings, Formulas und Events

- Binde darstellbaren Zustand deklarativ, zum Beispiel `value: '{suchtext}'`, `store: '{ergebnisse}'` oder `disabled: '{!kannOeffnen}'`. Vermeide parallelen Zustand im ViewModel und in Komponenten.
- Lege abgeleitete Werte wie `kannOeffnen`, `hatAuswahl` oder `kannSpeichern` in `formulas` ab. Verwende `get('…')` oder ein explizites `bind`, passend zu den Abhängigkeiten. Formulas berechnen Werte; sie laden keine Stores, senden keine Requests und verändern keine Komponenten.
- Verwende benannte Handler wie `handler: 'onSuchenClick'`, statt Ablauflogik im Komponentenbaum zu verteilen.
- Verwende `this.getViewModel()` für Zustand, `this.getStore('…')` für lokale Stores und `this.lookupReference('…')` für gezielten Zugriff auf Komponenten. Bevorzuge Bindings vor direkten Komponentenzugriffen und lokale Referenzen vor globalen Component Queries.

## 4. Lokal oder global entscheiden

**Standard: lokaler Store.** Suchergebnisse, Grids, Detaildaten sowie fenster- oder filterabhängige Listen gehören ins ViewModel. Zwei geöffnete Instanzen derselben View sollen sich nicht gegenseitig die Ergebnisse, Filter oder Auswahl überschreiben. Binde den Store in der View und lade ihn im ViewController, sobald der nötige Kontext vorliegt.

**Gemeinsame Konfiguration ist nicht dasselbe wie gemeinsamer Zustand.** Wenn mehrere Views dasselbe Model, denselben Proxy oder dieselben Store-Einstellungen brauchen, verwende bei Bedarf eine gemeinsame Store-Klasse, aber je ViewModel eine eigene Instanz.

**Global nur bei absichtlich geteilten Daten.** Anwendungsweit gemeinsam genutzte Nachschlagelisten können eine globale Store-Instanz bekommen. Verwende eine eindeutige `storeId`, registriere die Instanz nach Projektkonvention und greife über `Ext.getStore('<storeId>')` oder über die Store-ID in der View darauf zu. Ändere Filter, Sortierung oder Proxy-Parameter dieses Stores nicht für eine einzelne View. Derselbe REST-Endpunkt allein ist kein Grund für einen globalen Store.

## 5. Datenzugriff und globale Abläufe

- Lade Listen über Store und Proxy. Prüfe URL, HTTP-Methode, Parameter, Reader und `rootProperty` am tatsächlichen Endpunkt. Verwende `load({ params: … })` für Parameter eines einzelnen Ladevorgangs, statt den Proxy dauerhaft zu ändern.
- Verwende Model- oder Store-Persistenz, wenn sie zum Projekt und zum Backend-Vertrag passt. Für Einzelaktionen ohne passenden Store-Bezug kann `Ext.Ajax.request()` sinnvoll sein.
- Lade automatisch nur, wenn der nötige Kontext bereits verfügbar ist. Behandle Ladezustand, leere Ergebnisse und Fehler getrennt. Prüfe bei fachlichen Aktionen neben dem HTTP-Erfolg auch den Rückgabevertrag des Backends.
- Nutze bestehende Anwendungscontroller oder App-Events für tatsächlich viewübergreifende Abläufe, etwa zentrales Öffnen von Fenstern oder Navigation. Greife aus einer View nicht über einen globalen Controller auf die internen Komponenten einer anderen View zu.
- Verwende UI-Bindings für Sichtbarkeit und Bedienbarkeit, nicht als Ersatz für Berechtigungsprüfungen im Backend.

## 6. Referenzmuster

Das Beispiel zeigt eine View, die einen lokalen Store bindet und ihn über ihren ViewController lädt. Namespace, Aliase, Endpunkt und Reader sind Platzhalter für die Konventionen des Zielprojekts.

```javascript
// app/view/suche/Ergebnisliste.js
Ext.define('MeineApp.view.suche.Ergebnisliste', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.suche-ergebnisliste',

    requires: [
        'MeineApp.view.suche.ErgebnislisteViewModel',
        'MeineApp.view.suche.ErgebnislisteViewController'
    ],

    controller: 'suche-ergebnisliste',
    viewModel: { type: 'suche-ergebnisliste' },

    bind: {
        store: '{ergebnisse}'
    },

    columns: [
        { text: 'Name', dataIndex: 'name', flex: 1 }
    ],

    tbar: [
        {
            xtype: 'textfield',
            emptyText: 'Suchbegriff',
            bind: { value: '{suchtext}' }
        },
        {
            text: 'Suchen',
            bind: { disabled: '{!kannSuchen}' },
            handler: 'onSuchenClick'
        }
    ]
});

// app/view/suche/ErgebnislisteViewModel.js
Ext.define('MeineApp.view.suche.ErgebnislisteViewModel', {
    extend: 'Ext.app.ViewModel',
    alias: 'viewmodel.suche-ergebnisliste',

    requires: [
        'MeineApp.model.suche.Ergebnis',
        'Ext.data.Store',
        'Ext.data.proxy.Ajax',
        'Ext.data.reader.Json'
    ],

    data: {
        suchtext: '',
        laedt: false
    },

    formulas: {
        kannSuchen: function (get) {
            var suchtext = (get('suchtext') || '').trim();
            return suchtext.length > 0 && !get('laedt');
        }
    },

    stores: {
        ergebnisse: {
            autoLoad: false,
            model: 'MeineApp.model.suche.Ergebnis',
            proxy: {
                type: 'ajax',
                url: 'rest/suche',
                reader: {
                    type: 'json',
                    rootProperty: 'list'
                }
            }
        }
    }
});

// app/view/suche/ErgebnislisteViewController.js
Ext.define('MeineApp.view.suche.ErgebnislisteViewController', {
    extend: 'Ext.app.ViewController',
    alias: 'controller.suche-ergebnisliste',

    requires: ['Ext.window.MessageBox'],

    onSuchenClick: function () {
        var vm = this.getViewModel();
        var suchtext = (vm.get('suchtext') || '').trim();

        if (!suchtext || vm.get('laedt')) {
            return;
        }

        vm.set('laedt', true);

        this.getStore('ergebnisse').load({
            params: { q: suchtext },
            scope: this,
            callback: function (records, operation, success) {
                if (this.destroying || this.destroyed) {
                    return;
                }

                vm.set('laedt', false);

                if (!success) {
                    Ext.Msg.alert('Suche', 'Die Ergebnisse konnten nicht geladen werden.');
                }
            }
        });
    }
});
```

## 7. Vor Abschluss prüfen

- Stimmen Dateipfad, Klassenname, Alias, `requires`, Registrierungen und Binding-Namen überein?
- Reagiert die Oberfläche auf Änderungen im ViewModel, ohne dass derselbe Zustand zusätzlich von Hand gesetzt wird?
- Bleiben zwei gleichzeitig geöffnete View-Instanzen unabhängig, wenn ihre Stores lokal sein sollen?
- Funktionieren Laden, leere Ergebnisse und Fehler, und wird der Ladezustand korrekt zurückgesetzt?
- Sind Klassen sowohl über den üblichen Entwicklungsstart als auch im vorgesehenen Build erreichbar? Wenn kein Build oder Browsertest möglich war, sage das ausdrücklich.

Bearbeite die maßgeblichen Quelldateien. Ändere Architect-Metadaten oder generierte Bundles nicht von Hand und exportiere nicht ungefragt neu. Ergänze keine Generator-Header, leeren Methoden oder Konstruktoren, die sich durch normale Klassenkonfiguration ersetzen lassen.