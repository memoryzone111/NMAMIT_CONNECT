package com.nmamit.connect

import android.content.Context

class DisplayCredentialStore(context: Context) {
    private val preferences = context.getSharedPreferences(
        "nmamit_display_session",
        Context.MODE_PRIVATE
    )

    fun getCredential(): String? {
        return preferences.getString("credential", null)
    }

    fun saveCredential(credential: String) {
        preferences.edit()
            .putString("credential", credential)
            .apply()
    }

    fun clearCredential() {
        preferences.edit()
            .remove("credential")
            .apply()
    }

    fun getDisplayId(): String? {
        return preferences.getString("display_id", null)
    }

    fun saveDisplayId(displayId: String) {
        preferences.edit()
            .putString("display_id", displayId)
            .apply()
    }
}
