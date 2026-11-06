package org.ownsee.app.ui

import android.content.Context
import android.text.format.DateFormat
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import org.ownsee.app.R

/**
 * The language the UI is actually showing. Not the device locale: on a phone
 * set to German the app falls back to English, and dates must follow the text.
 */
fun Context.uiLocale(): Locale = Locale.forLanguageTag(getString(R.string.locale_tag))

/** "Thu" or "Qui": Java gives "qui." for Portuguese. */
fun DayOfWeek.shortName(locale: Locale): String =
    getDisplayName(TextStyle.SHORT, locale).removeSuffix(".").replaceFirstChar { it.titlecase(locale) }

/** "Today", "Yesterday" or "Wed 4". */
fun Context.dayLabel(date: LocalDate, today: LocalDate): String = when (date) {
    today -> getString(R.string.today)
    today.minusDays(1) -> getString(R.string.yesterday)
    else -> "${date.dayOfWeek.shortName(uiLocale())} ${date.dayOfMonth}"
}

/** 11/5/2026 in en-US, 05/11/2026 in pt-BR. */
fun Context.numericDate(date: LocalDate): String {
    val locale = uiLocale()
    return date.format(DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "yMd"), locale))
}
